/*
 * ***** BEGIN LICENSE BLOCK *****
 *
 * RequestPolicy - A Firefox extension for control over cross-site requests.
 * Copyright (c) 2008-2012 Justin Samuel
 * Copyright (c) 2014-2015 Martin Kimmerle
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see {tag: "http"://www.gnu.org/licenses}.
 *
 * ***** END LICENSE BLOCK *****
 */

/* global Components */
const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

/* exported rpWindowManager */
this.EXPORTED_SYMBOLS = ["rpWindowManager"];

let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});

let {ScriptLoader: {importModule}} = Cu.import(
    "chrome://rpcontinued/content/lib/script-loader.jsm", {});
let {Logger} = importModule("lib/logger");
let {XULUtils} = importModule("lib/utils/xul");
let {Environment, ProcessEnvironment} = importModule("lib/environment");
let {ToolbarButtonController} = importModule(
    "controllers/windows.toolbarbutton");
let {StyleSheetsController} = importModule("controllers/windows.style-sheets");

//==============================================================================
// WindowListener
//==============================================================================

let WindowListener = (function() {
  let scope = {};
  Services.scriptloader.loadSubScript(
      "chrome://rpcontinued/content/main/window-manager.listener.js", scope);
  return scope.WindowListener;
}());

//==============================================================================
// WindowSubControllers
//==============================================================================

let WindowSubControllers = (function() {
  let self = {};

  const SUBCONTROLLERS = Object.freeze([
    ToolbarButtonController,
    StyleSheetsController,
  ]);

  const SUBCONTROLLERS_REVERSE = Object.freeze(
      SUBCONTROLLERS.slice().reverse());

  function callForEachController(fnName, reverse, ...args) {
    let controllers = reverse ? SUBCONTROLLERS_REVERSE : SUBCONTROLLERS;
    controllers.forEach(function(controller) {
      if (typeof controller[fnName] === "function") {
        controller[fnName].apply(null, args);
      }
    });
  }

  self.startup = callForEachController.bind(null, "startup", false);
  self.shutdown = callForEachController.bind(null, "shutdown", true);
  self.loadIntoWindow = callForEachController.bind(null, "loadIntoWindow",
                                                   false);
  self.unloadFromWindow = callForEachController.bind(null, "unloadFromWindow",
                                                     true);

  return self;
}());

//==============================================================================
// rpWindowManager
//==============================================================================

var rpWindowManager = (function() {
  let self = {};

  let frameScriptURI = "chrome://rpcontinued/content/ui/frame.js?" +
      Math.random();

  function loadIntoWindow(window) {
    // ==================================
    // # 1 : create a scope variable for RP for this window
    // ----------------------------------------------------
    window.rpcontinued = {};

    // ==================================
    // # 2 : load the overlay's and menu's javascript
    // ----------------------------------------------
    try {
      Services.scriptloader.loadSubScript(
          "chrome://rpcontinued/content/ui/overlay.js",
          window);
      Services.scriptloader.loadSubScript(
          "chrome://rpcontinued/content/ui/menu.js",
          window);
      Services.scriptloader.loadSubScript(
          "chrome://rpcontinued/content/ui/classicmenu.js",
          window);
    } catch (e) {
      Logger.warning(Logger.TYPE_ERROR,
                     "Error loading subscripts for window: " + e, e);
    }

    // ==================================
    // # 3 : add all XUL elements
    // --------------------------
    try {
      XULUtils.addTreeElementsToWindow(window, "mainTree");
    } catch (e) {
      Logger.warning(Logger.TYPE_ERROR,
                     "Couldn't add tree elements to window. " + e, e);
    }

    // ==================================
    // # 4 : controllers
    // -----------------
    WindowSubControllers.loadIntoWindow(window);

    // ==================================
    // # 5 : init the overlay
    // ----------------------
    try {
      // init must be called last, because it assumes that
      // everything else is ready
      window.rpcontinued.overlay.init();
    } catch (e) {
      Logger.warning(Logger.TYPE_ERROR,
          "An error occurred while initializing the overlay: " + e, e);
    }
  }

  function unloadFromWindow(window) {
    // # 5 : the overlay cares itself about shutdown.
    //       nothing to do here.

    // # 4 : controllers
    // -----------------
    WindowSubControllers.unloadFromWindow(window);

    // # 3 : remove all XUL elements
    XULUtils.removeTreeElementsFromWindow(window, "mainTree");

    // # 2 and 1 : remove the `rpcontinued` variable from the window
    // ---------------------------------------------------------
    // This wouldn't be needed when the window is closed, but this has to be
    // done when RP is being disabled.
    delete window.rpcontinued;
  }

  ProcessEnvironment.addStartupFunction(
      Environment.LEVELS.INTERFACE,
      function(data, reason) {
        WindowSubControllers.startup();
        forEachOpenWindow(loadIntoWindow);
        WindowListener.setLoadFunction(loadIntoWindow);
        WindowListener.setUnloadFunction(unloadFromWindow);
        WindowListener.startListening();

        // Load the framescript into all existing tabs.
        // Also tell the globalMM to load it into each new
        // tab from now on.
        var globalMM = Cc["@mozilla.org/globalmessagemanager;1"]
            .getService(Ci.nsIMessageListenerManager);
        globalMM.loadFrameScript(frameScriptURI, true);
      });

  ProcessEnvironment.addShutdownFunction(
      Environment.LEVELS.INTERFACE,
      function() {
        // Stop loading framescripts into new tabs.
        // --------------------------
        // Note that it's not necessary to tell the framescripts'
        // environments to shut down. Instead:
        // - In case the window is closed, the framescript will shut
        //   down on the ContentFrameMessageManager's "unload" event.
        // - In case the addon is being disabled or firefox gets quit,
        //   the ParentProcessEnvironment will send a message to all
        //   children.
        var globalMM = Cc["@mozilla.org/globalmessagemanager;1"]
            .getService(Ci.nsIMessageListenerManager);
        globalMM.removeDelayedFrameScript(frameScriptURI);

        forEachOpenWindow(unloadFromWindow);
        WindowSubControllers.shutdown();
        WindowListener.stopListening();
      });

  function forEachOpenWindow(functionToCall) {
    // Apply a function to all open browser windows
    let windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      functionToCall(windows.getNext().QueryInterface(Ci.nsIDOMWindow));
    }
  }

  return self;
}());
