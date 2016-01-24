/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const {interfaces: Ci, utils: Cu} = Components;

const {Services: Services} =
	Cu.import("resource://gre/modules/Services.jsm", {});
const {PlacesUtils: PlacesUtils} =
	Cu.import("resource://gre/modules/PlacesUtils.jsm", {});
const {XPCOMUtils: XPCOMUtils} =
	Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});
//const {console: console} =
//	Cu.import("resource://devtools/Console.jsm", {});


const BASE_ID = "only-icons";
const ANNO_NAME = BASE_ID + "/hide-personal-bookmarks-label";

const STARTED_DELAYED = "browser-delayed-startup-finished";

const BUNDLE = "chrome://" + BASE_ID + "/locale/" + BASE_ID + ".properties";
XPCOMUtils.defineLazyGetter(this, "_", function() {
	return Services.strings.createBundle(BUNDLE).GetStringFromName;
});


function BmsToolbarObserver(aWindow) {
	if (!(this instanceof BmsToolbarObserver))
		return new BmsToolbarObserver(aWindow);

	this.destroy();

	let placesContext = aWindow.document.getElementById("placesContext");
	let nextItem = aWindow.document
					.getElementById("placesContext_openSeparator").nextSibling;

	let menuitem = aWindow.document.createElement("menuitem");
	menuitem.id = BASE_ID + "-menuitem";
	menuitem.setAttribute("label", _("Hide bookmark label"));
	menuitem.setAttribute("accesskey", _("H"));
	menuitem.setAttribute("type", "checkbox");
	menuitem.setAttribute("disabled", false);
	menuitem.setAttribute("checked", false);
	menuitem.addEventListener("command", this, false);

	placesContext.insertBefore(menuitem, nextItem);

	this._menuitem = menuitem;

	menuitem = aWindow.document.createElement("menuseparator");
	menuitem.id = BASE_ID + "-separator";

	placesContext.insertBefore(menuitem, nextItem);

	this._separator = menuitem;
}

BmsToolbarObserver.prototype = {
	get placesView() BmsService.getWindowPlacesView(this._menuitem
															.ownerDocument
																.defaultView),

	QueryInterface: XPCOMUtils.generateQI([
			Ci.nsISupportsWeakReference,
			Ci.nsINavHistoryResultObserver,
		]),

	setup: function BSTO_setup() {
		try {
			let placesView = this.placesView;
			placesView._viewElt.addEventListener("contextmenu", this);
			placesView.result.addObserver(this, true);
		} catch(e) {}
	},

	destroy: function BSTO_destroy() {
		if (this._separator) {
			let separator = this._separator;
			this._separator = null;

			if (separator.parentNode)
				separator.parentNode.removeChild(separator);
		}

		if (!this._menuitem) return;

		try {
			let placesView = this.placesView;
			placesView._viewElt.removeEventListener("contextmenu", this);
			placesView.result.removeObserver(this);
		} catch(e) {}

		let menuitem = this._menuitem;
		this._menuitem = null;

		menuitem.removeEventListener("command", this);
		if (menuitem.parentNode)
			menuitem.parentNode.removeChild(menuitem);
	},

	// EventListener
	handleEvent: function BSTO_handleEvent(aEvent) {
		switch (aEvent.type) {
			case "command":
				if (aEvent.target === this._menuitem)
					BmsService.nodeShouldHideLabel(this.placesView.selectedNode,
										aEvent.target.getAttribute("checked"));
				break;

			case "contextmenu":
				if (!aEvent.target._placesNode || !this._menuitem) break;
				let placesNode = aEvent.target._placesNode;
				let menuitem = this._menuitem;

				let show = BmsService.isNodeToolbarBookmark(placesNode);
				menuitem.hidden = !show;

				if (show) {
					menuitem.setAttribute("disabled", !placesNode.title);
					menuitem.setAttribute("checked",
								BmsService.shouldNodeHideLabel(placesNode));
				}
				break;
		}
	},

	// nsINavHistoryResultObserver
	nodeAnnotationChanged:
	function BSTO_nodeAnnotationChanged(aNode, aAnnoName) {
		if (aAnnoName == ANNO_NAME)
			BmsService.updateNodeLabel(aNode, this.placesView);
	},

	nodeTitleChanged: function BSTO_nodeTitleChanged(aNode, aNewTitle) {
		if (BmsService.shouldNodeHideLabel(aNode))
			this.placesView.nodeTitleChanged(aNode, "");
	},

	nodeInserted: function BSTO_nodeInserted(aParent, aNode, aNewIndex) {
		if (BmsService.shouldNodeHideLabel(aNode))
			this.placesView.nodeTitleChanged(aNode, "");
	},

	batching: function() {},
	containerStateChanged: function() {},
	invalidateContainer: function() {},
	nodeDateAddedChanged: function() {},
	nodeHistoryDetailsChanged: function() {},
	nodeIconChanged: function() {},
	nodeKeywordChanged: function() {},
	nodeLastModifiedChanged: function() {},
	nodeMoved: function() {},
	nodeRemoved: function() {},
	nodeReplaced: function() {},
	nodeTagsChanged: function() {},
	nodeURIChanged: function() {},
	sortingChanged: function() {},
}


const BmsService = {
	_prefs: null,
	_running: 0,
	_observers: null,

	get hideByDefault() this._prefs.getBoolPref(".hide-by-default", false),

	QueryInterface: XPCOMUtils.generateQI([
			Ci.nsISupportsWeakReference,
			Ci.nsIObserver,
		]),

	startup: function BSS_startup() {
		if (++this._running > 1) return;
		this._running = 1;

		this._observers = new WeakMap();

		Services.obs.addObserver(this, STARTED_DELAYED, true);

		this._prefs = Services.prefs.getBranch("extensions." + BASE_ID);
		this._prefs.addObserver(".hide-by-default", this, true);

		this._forEachWindow(this._regWindow);
	},

	shutdown: function BSS_shutdown() {
		if (--this._running != 0) return;

		Services.obs.removeObserver(this, STARTED_DELAYED);

		this._prefs.removeObserver(".hide-by-default", this);
		this._prefs = null;

		this._forEachWindow(this._unregWindow);

		this._observers = null;
	},

	getWindowPlacesView: function BSS_getWindowPlacesView(domWindow) {
		let viewElt = domWindow.PlacesToolbarHelper._viewElt;
		return viewElt._placesView;
	},

	updateNodeLabel: function BSS_updateNodeLabel(aPlacesNode, aPlacesView) {
		this._updateNodeLabel(aPlacesNode, aPlacesView, this.hideByDefault);
	},

	nodeShouldHideLabel:
	function BSS_nodeShouldHideLabel(aPlacesNode, aShouldHideLabel) {
		PlacesUtils.setAnnotationsForItem(aPlacesNode.itemId, [{
			name: ANNO_NAME,
			value: aShouldHideLabel,
		}]);
	},

	shouldNodeHideLabel: function BSS_shouldNodeHideLabel(aPlacesNode) {
		return this._shouldNodeHideLabel(aPlacesNode, this.hideByDefault);
	},

	isNodeToolbarBookmark: function BSS__isNodeToolbarBookmark(aPlacesNode) {
		return aPlacesNode && PlacesUtils.nodeIsBookmark(aPlacesNode) &&
			aPlacesNode.parent &&
			aPlacesNode.parent.itemId == PlacesUtils.toolbarFolderId &&
			aPlacesNode.type == Ci.nsINavHistoryResultNode.RESULT_TYPE_URI;
	},

	_forEachWindow: function BSS__forEachWindow(aCallback) {
		Array.prototype.unshift.call(arguments, null);
		let windows = Services.wm.getEnumerator("navigator:browser");
		while (windows.hasMoreElements()) {
			let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
			if (!this._isWindowBrowser(domWindow)) continue;

			arguments[0] = domWindow;
			arguments[1] = this.getWindowPlacesView(domWindow);

			aCallback.apply(this, arguments);
		}
	},

	_isWindowBrowser: function BSS__isWindowBrowser(aWindow) {
		return aWindow && aWindow.location &&
				aWindow.location == "chrome://browser/content/browser.xul";
	},

	_regWindow: function BSS__regWindow(aWindow, aPlacesView) {
		let observer = this._observers.get(aWindow);

		if (!observer) {
			observer = new BmsToolbarObserver(aWindow);
			this._observers.set(aWindow, observer);

			aWindow.CustomizableUI.addListener(this);
		}

		observer.setup();

		let byDefault = this.hideByDefault;
		this._foreachToolbarBookmarkNode(aPlacesView, function(aNode) {
			this._updateNodeLabel(aNode._placesNode, aPlacesView, byDefault);
		});
	},

	_unregWindow: function BSS__unregWindow(aWindow, aPlacesView) {
		let observer = this._observers.get(aWindow);
		if (!observer) return;

		aWindow.CustomizableUI.removeListener(this);

		this._foreachToolbarBookmarkNode(aPlacesView, function(aNode) {
			let placesNode = aNode._placesNode;
			aPlacesView.nodeTitleChanged(placesNode, placesNode.title);
		});

		observer.destroy();
		this._observers.remove(aWindow);
	},

	_updateNodeLabel:
	function BSS__updateNodeLabel(aPlacesNode, aPlacesView, aDefault) {
		if (this._shouldNodeHideLabel(aPlacesNode, aDefault))
			aPlacesView.nodeTitleChanged(aPlacesNode, "");
		else
			aPlacesView.nodeTitleChanged(aPlacesNode, aPlacesNode.title);
	},

	_foreachToolbarBookmarkNode:
	function BSS__foreachToolbarBookmarkNode(aPlacesView, aCallback) {
		if (!aPlacesView) return;

		let nodes = aPlacesView._rootElt.childNodes;
		for (let i = 0; i < nodes.length; i++) {
			if (this.isNodeToolbarBookmark(nodes[i]._placesNode))
				if (aCallback.call(this, nodes[i]))
					break;
		}
	},

	_shouldNodeHideLabel:
	function BSS__shouldNodeHideLabel(aPlacesNode, aDefault) {
		try {
			return PlacesUtils.annotations
						.getItemAnnotation(aPlacesNode.itemId, ANNO_NAME);
		} catch (e) {
			return aDefault;
		}
	},

	// CustomizableUIListener
	onWidgetAdded: function BSS_onWidgetAdded(aWidgetId, aArea, aPosition) {
		if (aWidgetId == "personal-bookmarks")
			this._forEachWindow(this._regWindow);
	},

	onCustomizeEnd: function BSS_onCustomizeEnd(aWindow) {
		this._regWindow(aWindow, this.getWindowPlacesView(aWindow));
	},

	// nsIObserver
	observe: function BSS_observe(aSubject, aTopic, aData) {
		switch (aTopic) {
			case STARTED_DELAYED:
				let domWindow = aSubject.QueryInterface(Ci.nsIDOMWindow);

				if (!this._isWindowBrowser(domWindow)) break;

				this._regWindow(domWindow, this.getWindowPlacesView(domWindow));
				break;

			case "nsPref:changed":
				if (aData != ".hide-by-default") break;

				this._forEachWindow(function(aWindow, aPlacesView, aDefault) {
					this._foreachToolbarBookmarkNode(aPlacesView,
						function(aNode) {
							this._updateNodeLabel(aNode._placesNode,
												aPlacesView, aDefault);
					});
				}, this.hideByDefault);
				break;
		}
	},
};


function startup(aData, aReason) {
	let prefs = Services.prefs.getDefaultBranch("extensions." + BASE_ID);
	prefs.setBoolPref(".hide-by-default", false);
	BmsService.startup();
}

function shutdown(aData, aReason) {
	if (aReason == APP_SHUTDOWN) return;
	BmsService.shutdown();
}

function install(aData, aReason) {}
function uninstall(aData, aReason) {}

