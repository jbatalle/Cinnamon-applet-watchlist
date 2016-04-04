// ------------
// Imports
// ------------
const Applet = imports.ui.applet; const Util = imports.misc.util;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Soup = imports.gi.Soup;

// ------------
// Constants
// ------------
const UUID = "watchlist@yjwu";
const ICON_DIR = imports.ui.appletManager.appletMeta[UUID].path + "/icons/";

const QUERY_URL_YAHOO = "https://query.yahooapis.com/v1/public/yql?q=";
const QUERY_PARAMS_YAHOO = "&format=json&diagnostics=false&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback=";
const QUERY_YQL = "select Symbol,LastTradePriceOnly,Change,ChangeinPercent from yahoo.finance.quotes where symbol in ";
const QUERY_CHART_YAHOO = "http://chart.finance.yahoo.com/z?s=";
const QUERY_CHART_PARAMS_YAHOO = "&t=1d&q=l&l=on&z=s";
const QUERY_URL_GOOGLE = "http://www.google.com/finance/info?q=";
const QUERY_CHART_GOOGLE = "https://www.google.com/finance?q=";

const MOVE = { '-1': "loss", '0': "unchanged", '1': "gain" , NaN: "unknown"};
const SOURCE = { "yahoo": "Yahoo! Finance", "google": "Google Finance" };

const ATTRIBUTES = ['source', 'period-refresh', 'period-rotate', 'display-allocations', 'change-unit', 'portfolio', 'verbose', 'show-S&P500', 'show-DJI', 'show-Nasdaq', 'show-VIX', 'show-TN10Y'];
const INDEX_NAMES = ['S&P500', 'DJI', 'Nasdaq', 'VIX', 'TN10Y'];
const INDEX_SYMBOLS = {"google": [".INX", ".DJI", ".IXIC", "INDEXCBOE:VIX", "INDEXCBOE:TNX"], "yahoo": ["^GSPC", "^DJI", "^IXIC", "^VIX", "^TNX"]};

// ------------
// Soup
// ------------
const _httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());

// ------------
// Util
// ------------
_format = function(x, sign) {
    return (sign ? (x < 0 ? "-" : "+") : "") + Math.abs(x).toFixed(2);
}

_sign = function(x) {
    if (isNaN(x['Change'])) {
        return NaN;
    } else if (x['Change']> 0 || x['ChangeinPercent'] > 0) { 
        return 1;
    } else if (x['Change'] < 0 || x['ChangeinPercent'] < 0) {
        return -1
    } else {
        return 0;
    }
}

// -----------------------------------------
// WatchlistItem: row in the drop-down list
// -----------------------------------------
function WatchlistItem() {
    this._init.apply(this, arguments);
}

WatchlistItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(name, values, is_header, has_allocation, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        let row = new St.BoxLayout();
        let width = [56, 60, 108, 72];
        let iconBox = new St.BoxLayout({ width: 30 });
 
        // Get contents of cells
        if (is_header) {
            var col = ['Symbol', 'Last', 'Change'];
            if (has_allocation) col.push('Allocation');
        } else {
            iconBox.add_actor(new St.Icon({ style_class: "icon-" + MOVE[_sign(values)] }));
            var col = [name, _format(values['Last'], false),
                       _format(values['Change'], true) + " (" + _format(values['ChangeinPercent'], true) + "%)"];
            if (has_allocation) col.push(isFinite(values['Allocation']) ? _format(values['Allocation'], false) + "%" : "---");
        }

        // Add cells to a row
        row.add_actor(iconBox);
        for (let i=0; i<col.length; i++) {
            let alignBox = new St.BoxLayout({ style_class: i > 0 ? "alignbox" : "" });
            if (isNaN(values['Change'])) {
                var text_style = "text-unknown";
            } else {
                var text_style = !is_header && i === 2 ? "text-" + MOVE[_sign(values)] : "text-common";
            }
            alignBox.add_actor(new St.Label({ style_class: text_style, width: width[i], text: col[i] })); 
            row.add_actor(alignBox);
        }
        this.addActor(row);

    }
};

// -----------------------------------------
// MyApplet
// ------------------------------------------
function MyApplet(orientation, panel_height, instance_id) {
    this._init(orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _data: { "Portfolio": { 'Last': NaN, 'Change': NaN, 'ChangeinPercent': NaN } }, // Parsed data 
    _portf: Object(),                                                               // Parsed portfolio
    _symbol_list: [],                                                               // List of symbols in rotation
    _preferences: Object(),                                                         // Settings
    _failure: null,                                                                 // Item of error message
    _timestamp: null,                                                               // Item of timestamp

    _init: function(orientation, panel_height, instance_id) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        // Bind settings
        this.settings = new Settings.AppletSettings(this._preferences, UUID, instance_id);
        ATTRIBUTES.forEach(function(key) {
            this.settings.connect("changed::" + key, 
                Lang.bind(this, function() { this.onSettingChanged(key); }));
            this._preferences[key] = this.settings.getValue(key);
        }, this);

        // Panel
        this.set_applet_icon_name("watchlist");
        this.set_applet_tooltip("Click to open");
        this.set_applet_icon_path(ICON_DIR + "icon.svg");

        // PopupMenu (drop-down list)
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menuManager.addMenu(this.menu);
    
        // Run 
        this.buildListHeader(true);
        this._refreshTimeout(1);

    },

    on_applet_clicked: function(event) {
        this.menu.toggle();
    },

    onSettingChanged: function(key) {
        this.buildListHeader(true);
        this._preferences[key] = this.settings.getValue(key);
        this._refreshTimeout(key === "portfolio" ? 5 : 2);
    },

    onLoading: function() {
        Mainloop.source_remove(this._rotate_timeout);
        this.set_applet_icon_path(ICON_DIR + "icon.svg");
        this.set_applet_label("")
        this.menu.addMenuItem(new PopupMenu.PopupMenuItem("Loading data...", { reactive: false }));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    },

    // Parse portfolio in settings
    parsePortf: function() { 
        let raw = this._preferences['portfolio'];
        raw = this._preferences['source'] === "yahoo" ? raw.replace('.', '-') : raw.replace('-', '.');
        this._portf = raw.split(";").reduce(function(obj, p) {
            if (p.length > 0) {
                let pair = p.split(",");
                let symbol = pair[0].replace(' ', '').substring(0, 6).toUpperCase();
                obj[symbol] = parseInt(pair[1]);
            }
            return obj;
        }, Object());
    },

    // -----------------------------------
    // Methods for build a drop-down list
    // -----------------------------------
    buildListHeader: function(on_loading) {
        this.menu.removeAll();
        this.menu.addMenuItem(new WatchlistItem("", "", true, this._preferences['display-allocations'], { reactive: false }));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        if (on_loading) {
            this.onLoading();
        }
    },

    buildListItem: function(symbol_full, name, is_index) {
        let symbol = symbol_full.split(':').pop();
        if (this._data.hasOwnProperty(symbol)) {
            var values = this._data[symbol];
            this._symbol_list.push([symbol, name, is_index]);
        } else {
            var values = { 'Last': NaN, 'Change': NaN, 'ChangeinPercent': NaN };
        }

        let item = new WatchlistItem(name, values, false, this._preferences['display-allocations']);
        item.connect("activate", Lang.bind(this, function() { Util.spawnCommandLine(this._getChart(symbol_full)); }));
        this.menu.addMenuItem(item);
    },

    buildTimestamp: function() {
        if (this._timestamp != null) {
            this._timestamp.destroy();
        }
        this._timestamp = new PopupMenu.PopupMenuItem(
                "Last Updated: " + (new Date()).toLocaleString() + " from " + SOURCE[this._preferences['source']],
                { style_class: "text-status", reactive: false });
        this.menu.addMenuItem(this._timestamp);
    },
 
    buildFullList: function() {
        this.buildListHeader(false);
        Object.keys(this._portf).forEach(function(symbol) { return this.buildListItem(symbol, symbol, false); }, this);

        if (Object.keys(this._portf).length > 0 && this.indexSymbols.length > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
        this.indexSymbols.forEach(function(symbol) { return this.buildListItem(symbol[0], symbol[1], true); }, this)
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    },

    // ----------------------------
    // Methods for refreshing data
    // ----------------------------
    refreshData: function() { 
        let context = this; 

        // Get symbols to be queried
        this.parsePortf(); 
        let query_symbols = Object.keys(this._portf);
        this.indexSymbols = 
            INDEX_SYMBOLS[this._preferences['source']]
                .map(function(symbol, i) { 
                    return [symbol, INDEX_NAMES[i]]; })
                .filter(function(item, i) { 
                        let idx = ATTRIBUTES[i+7];
                        if (this._preferences[idx]) {
                            query_symbols.push(item[0]);
                        }
                        return this._preferences[idx]; 
                }, this);

        // Request and update
        let request = Soup.Message.new('GET', this._getURL(query_symbols));
        _httpSession.queue_message(request, function(session, message) {
            try {
                context.updateData(message.response_body.data);
                context.buildFullList();
                context.updatePanel();
            } catch (error) {
                let note = "Unable to process data from " + SOURCE[context._preferences['source']] + 
                           ". Error message: " + error.message;
                if (context._failure != null) {
                    context._failure.destroy();
                }
                context._failure = new PopupMenu.PopupMenuItem(note, { style_class: "text-status", reactive: false });
                context.menu.addMenuItem(context._failure);
                context._displayNotification("Bad response", note, 10);
                global.log(error);
            } 
            context.buildTimestamp();
        });
        this._refreshTimeout(60 * context._preferences['period-refresh']);

    },

    updateData: function(raw) {
        // Parse and set keys according to the source
        if (this._preferences['source'] === "yahoo") {
            var data = JSON.parse(raw)['query']['results']['quote'];
            var symbol = 'Symbol';
            var last = 'LastTradePriceOnly';
            var change = 'Change';
            var changeinpercent = 'ChangeinPercent';
        } else {
            var data = JSON.parse(raw.substring(4));
            var symbol = 't';
            var last = 'l_fix';
            var change = 'c_fix';
            var changeinpercent = 'cp_fix';
        } 
  
        // Add data in this._data
        this._data = data.reduce(function(obj, quote) {
            if (quote[last] !== null && isFinite(quote[last])) {
                obj[quote[symbol]] = {
                    'Last': quote[last],
                    'Change': quote[change],
                    'ChangeinPercent': parseFloat(quote[changeinpercent].replace('%', ''))
                };
            } 
            return obj;
        }, Object());

        // Compute allocations
        if (this._preferences['display-allocations'] || this._preferences['change-unit'] !== "none") {
            var change = 0;
            var curr = 0;
            Object.keys(this._portf).forEach(function(symbol) {
                if (this._data.hasOwnProperty(symbol) && 
                    isFinite(this._data[symbol]['Last']) && 
                    isFinite(this._portf[symbol])) {
                    this._data[symbol]['Allocation'] = Math.abs(this._data[symbol]['Last'] * this._portf[symbol]);
                    change += this._data[symbol]['Change'] * this._portf[symbol];
                    curr += this._data[symbol]['Allocation'];
                }
            }, this);
       
        }

        this._data['Portfolio'] = {
                'Last': curr,
                'Change': change,
                'ChangeinPercent': 100 * change / (curr - change)
            };
 
        if (this._preferences['display-allocations']) {
            Object.keys(this._portf).forEach(function(symbol) { 
                if (this._data.hasOwnProperty(symbol)) {
                    this._data[symbol]['Allocation'] *= 100 / curr; 
                }
            }, this);
        }
        
    },

    // -----------------------------
    // Methods for updating panel
    // -----------------------------
    updatePanel: function() {
        if (this._preferences['period-rotate'] > 0) {
            this.rotate(0);
        } else {
            let icon = ICON_DIR + MOVE[_sign(this._data['Portfolio'])] + ".svg";
            switch (this._preferences['change-unit']) {
                case "percentage":
                    this.set_applet_label(isNaN(this._data['Portfolio']['ChangeinPercent']) ? "-.--%" : 
                            _format(this._data['Portfolio']['ChangeinPercent'], false) + "%");
                    break;
                case "dollars":
                    this.set_applet_label(isNaN(this._data['Portfolio']['Change']) ? "$-.--" : 
                            "$" + _format(this._data['Portfolio']['Change'], false));
                    break;
                default:
                    icon = ICON_DIR + "icon.svg";
                    this.set_applet_label("");
            }
    
            this.set_applet_icon_path(icon);
        }

    },

    rotate: function(i) {
        Mainloop.source_remove(this._rotate_timeout);
        let item = this._symbol_list[i];
        let symbol = item[0];
        switch (this._preferences['change-unit']) {
            case "percentage":
                var change = " (" + (isNaN(this._data[symbol]['ChangeinPercent']) ? "-.--%" : 
                    _format(this._data[symbol]['ChangeinPercent'], true) + "%") + ")";
                break;
            case "dollars":
                var change = " (" + (isNaN(this._data[symbol]['Change']) ? "-.--" : 
                    _format(this._data[symbol]['Change'], true)) + ")";
                break;
            case "none":
                var change = "";
                break;
            default:
                var change = "NaN";
        }
    
        this.set_applet_icon_path(ICON_DIR + MOVE[_sign(this._data[symbol])] + ".svg");
        this.set_applet_label(item[1] + ": " + (item[2] ? "" : "$") + this._data[symbol]['Last'] + change);
    
        this._rotate_timeout = Mainloop.timeout_add_seconds(this._preferences['period-rotate'], 
                Lang.bind(this, function() { return this.rotate((i + 1) % this._symbol_list.length); }));
    },

    //---------
    // Helpers
    //---------
    _refreshTimeout: function(sec) {
        Mainloop.source_remove(this._refresh_timeout);
        this._refresh_timeout = Mainloop.timeout_add_seconds(sec, Lang.bind(this, this.refreshData));
    },

    _getURL: function(symbols) {
        if (this._preferences['source'] === "yahoo") {
            return QUERY_URL_YAHOO + encodeURIComponent(QUERY_YQL + "('" + symbols.join("','") + "')") + QUERY_PARAMS_YAHOO;
        } else {
            return QUERY_URL_GOOGLE + symbols.join(",");
        }
    },

    _getChart: function(symbol) {
        if (this._preferences['source'] === "yahoo") {
            return "xdg-open " + QUERY_CHART_YAHOO + symbol + QUERY_CHART_PARAMS_YAHOO;
        } else {
            return "xdg-open " + QUERY_CHART_GOOGLE + symbol;
        }
    },

    _displayNotification: function(title, msg, t) {
        if (this._preferences['verbose']) 
            Util.spawnCommandLine("notify-send \"" + title + "\" \"" + msg + "\" -t " + t + " -u low -i emblem-marketing");
    }

};

// -----------------------------------------
// Main
// ------------------------------------------
function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(orientation, panel_height, instance_id);
}
