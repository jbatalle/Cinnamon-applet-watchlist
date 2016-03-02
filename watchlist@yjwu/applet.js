const Applet = imports.ui.applet;
const Util = imports.misc.util;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const St = imports.gi.St;

const Soup = imports.gi.Soup;
const _httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());

const UUID = "watchlist@yjwu";
const IconDir = imports.ui.appletManager.appletMeta[UUID].path + "/icons/icon-";

const QUERY_URL_YAHOO = "https://query.yahooapis.com/v1/public/yql?q=";
const QUERY_PARAMS_YAHOO = "&format=json&diagnostics=false&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback=";
const QUERY_YQL = "select Symbol,LastTradePriceOnly,Change,ChangeinPercent from yahoo.finance.quotes where symbol in ";
const QUERY_CHART_YAHOO = "http://chart.finance.yahoo.com/z?s=";
const QUERY_CHART_PARAMS_YAHOO = "&t=1d&q=l&l=on&z=s";
const QUERY_URL_GOOGLE = "http://www.google.com/finance/info?q=";
const QUERY_CHART_GOOGLE = "https://www.google.com/finance?q=";

const MOVE = { '-1': "loss", '0': "unchanged", '1': "gain" };

const ATTRIBUTES = ['source', 'period', 'display-portf', 'change-display', 'portfolio', 'verbose', 'show-S&P500', 'show-DJI', 'show-Nasdaq', 'show-VIX', 'show-TN10Y', 'show-Nikkei', 'show-TSEC', 'show-HSI', 'show-DAX', 'show-CAC40', 'show-FTSE100', 'show-TSX', 'show-Ibovespa'];
const INDEX_NAMES = ['S&P500', 'DJI', 'Nasdaq', 'VIX', 'TN10Y', 'Nikkei', 'TSEC', 'HSI', 'DAX', 'CAC40', 'FTSE100', 'TSX', 'Ibovespa'];
const INDEX_SYMBOLS = {"yahoo": ["^GSPC", "^DJI", "^IXIC", "^VIX", "^TNX", "^N225", "^TWII", "^HSI", "^GDAXI", "^FCHI", "^FTSE", "^GSPTSE", "^BVSP"], "google": [".INX", ".DJI", ".IXIC", "INDEXCBOE:VIX", "INDEXCBOE:TNX", "INDEXNIKKEI:NI225", "TPE:TAIEX", "INDEXHANGSENG:HSI", "INDEXDB:DAX", "INDEXEURO:PX1", "INDEXFTSE:UKX", "INDEXTSI:OSPTX", "INDEXBVMF:IBOV"]};

_format = function(x) {
    return (x < 0 ? "-" : "") + Math.abs(x).toFixed(2);
}
_sign = function(x) {
    return isNaN(x) || x == 0 ? 0 : (x > 0 ? 1 : -1);
}

function WatchlistItem() {
    this._init.apply(this, arguments);
}

WatchlistItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(name, values, isHeader, hasAllocation, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        let row = new St.BoxLayout();
        let width = [56, 60, 108, 72];
        let iconBox = new St.BoxLayout({ width: 30 });
        row.add_actor(iconBox);
 
        if (isHeader) {
            var col = ['Symbol', 'Last', 'Change'];
            hasAllocation && col.push('Allocation');
        } else {
            iconBox.add_actor(new St.Icon({ style_class: "icon-" + MOVE[_sign(values['Change'])] }));
            var col = [name, _format(values['Last']),
                       _format(values['Change']) + " (" + _format(values['ChangeinPercent']) + "%)"];
            hasAllocation && col.push(isFinite(values['Pos']) ? _format(values['Pos']) + "%" : "---");
        }

        for (let i=0; i<col.length; i++) {
            let alignBox = new St.BoxLayout({ style_class: i > 0 ? "alignbox" : "" });
            let text_style = !isHeader && i == 2 ? "text-" + MOVE[_sign(values['Change'])] : "";
            alignBox.add_actor(new St.Label({ style_class: text_style, width: width[i], text: col[i] }));
            row.add_actor(alignBox);
        }
        this.addActor(row);

    }
};


function MyApplet(orientation, panel_height, instance_id) {
    this._init(orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _data: { "TOTALVALUE": 0 },
    _portf: Object(),
    _preferences: Object(),

    _init: function(orientation, panel_height, instance_id) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        this.settings = new Settings.AppletSettings(this._preferences, "watchlist@yjwu", instance_id);
        ATTRIBUTES.forEach(function(key) {
            this.settings.connect("changed::" + key, 
                Lang.bind(this, function() { this.onSettingChanged(key); }));
            this._preferences[key] = this.settings.getValue(key);
        }, this);

        this.set_applet_icon_name("watchlist");
        this.set_applet_tooltip("Click to open");
        this.set_applet_icon_path(IconDir + "unchanged.svg");
        this.updatePanel();

        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menuManager.addMenu(this.menu);

        this.buildListHeader(true);
        this.onSettingChanged("portfolio");
        this._refreshTimeout(1);

    },

    on_applet_clicked: function(event) {
        this.menu.toggle();
    },

    onSettingChanged: function(key) {
        this.buildListHeader(true);
        this._preferences[key] = this.settings.getValue(key);
        key === "portfolio" && this.parsePortf();
        this._refreshTimeout(key === "portfolio" ? 5 : 2);
    },

    buildListHeader: function(isLoading) {
        this.menu.removeAll();
        this.menu.addMenuItem(new WatchlistItem("", "", true, this._preferences['display-portf'], { reactive: false }));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        isLoading && this.menu.addMenuItem(new PopupMenu.PopupMenuItem("Loading data...", { reactive: false }));
    },

    getListItem: function(symbol_full, name) {
        let symbol = symbol_full.split(':').pop();
        let item = new WatchlistItem(name, this._data[symbol], false, this._preferences['display-portf']);
        item.connect("activate", Lang.bind(this, function() { Util.spawnCommandLine(this._getChart(symbol_full)); }));
        this.menu.addMenuItem(item);
    },

    buildFullList: function() {
        this.buildListHeader(false);
        let sep = false;
        Object.keys(this._portf).forEach(function(symbol) { sep = true; return this.getListItem(symbol, symbol); }, this);

        sep && this.indexSymbols.length > 0 && this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.indexSymbols.forEach(function(symbol) { return this.getListItem(symbol[0], symbol[1]); }, this)

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                    "Last Updated: " + (new Date()).toLocaleString() + " from " + this.source,
                    { style_class: "text-datetime", reactive: false }));
    },

    parsePortf: function() {
        let raw = this._preferences['portfolio'];
        let pair = this._preferences['source'] == "yahoo" ? raw.replace('.', '-') : raw.replace('-', '.');
        let pairs = raw.split(";");

        this._portf = pairs.reduce(function(obj, p) {
            if (p.length > 0) {
                let pair = p.split(",");
                let symbol = pair[0].replace(' ', '').substring(0, 5).toUpperCase();
                obj[symbol] = parseInt(pair[1]);
            }
            return obj;
        }, Object());
    },

    refreshData: function() {
        let context = this;
        let query_symbols = Object.keys(this._portf);
        this.source = this._preferences["source"] === "yahoo" ? "Yahoo! Finance" : "Google Finance";
        this.indexSymbols = 
            INDEX_SYMBOLS[this._preferences['source']]
                .map(function(symbol, i) { 
                    return [symbol, INDEX_NAMES[i]]; })
                .filter(function(item, i) { 
                        let show = this._preferences[ATTRIBUTES[i+6]];
                        show && query_symbols.push(item[0]);
                        return show; 
                }, this);

        let request = Soup.Message.new('GET', this._getURL(query_symbols));
        _httpSession.queue_message(request, function(session, message) {
            try {
                context.updateData(message.response_body.data);
                context.buildFullList();
                context.updatePanel();
            } catch (error) {
                context._displayNotification("Bad response", 
                    "Unable to parse the response from " + context.source + 
                    ". Please try to remove some symbols/indexes or select the other source.", 10);
                global.log(error);
            }
        });

        this._refreshTimeout(60 * this._preferences['period']);
    },

    updateData: function(raw) {
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
  
        let invalid = [];
        this._data = data.reduce(function(obj, quote) {
            if (quote[last] !== null && isFinite(quote[last])) {
                obj[quote[symbol]] = {
                    'Last': quote[last],
                    'Change': quote[change],
                    'ChangeinPercent': parseFloat(quote[changeinpercent].replace('%', ''))
                };
            } else {
                obj[quote[symbol]] = {
                    'Last': NaN,
                    'Change': NaN,
                    'ChangeinPercent': NaN
                };
                invalid.push(quote[symbol]);
            }
            return obj;
        }, Object());

        invalid.length > 0 && this._displayNotification("Invalid Portfolio", 
                "Unable to fetch data of '" + invalid.join("', '") + "' from " + this.source + ".", 10);
        
        if (this._preferences['display-portf']) {
            this._preferences['change-display'] = this.settings.getValue('change-display');
            let change = 0;
            let curr = 0;
            Object.keys(this._portf).forEach(function(symbol) {
                if (isFinite(this._data[symbol]['Last']) && isFinite(this._portf[symbol])) {
                    this._data[symbol]['Pos'] = Math.abs(this._data[symbol]['Last'] * this._portf[symbol]);
                    change += this._data[symbol]['Change'] * this._portf[symbol];
                    curr += this._data[symbol]['Pos'];
                }
            }, this);
    
            Object.keys(this._portf).forEach(function(symbol) { this._data[symbol]['Pos'] *= 100 / curr; }, this);
    
            this._data['TOTALVALUE'] = {
                'Last': curr,
                'Change': change,
                'ChangeinPercent': 100 * change / (curr - change)
            };
        } else {
            this._preferences['change-display'] = "none";
        }
    },

    updatePanel: function() {
        switch (this._preferences['change-display']) {
            case "percentage":
                this.set_applet_label(isNaN(this._data['TOTALVALUE']['ChangeinPercent']) ? "-.--%" : 
                        _format(this._data['TOTALVALUE']['ChangeinPercent']) + "%");
                break;
            case "dollars":
                this.set_applet_label(isNaN(this._data['TOTALVALUE']['Change']) ? "$-.--" : 
                        "$" + _format(this._data['TOTALVALUE']['Change']));
                break;
            case "none":
                this.set_applet_label("");
                break;
            default:
                this.set_applet_label("---");
        }

        this.set_applet_icon_path(IconDir + MOVE[_sign(this._data['TOTALVALUE']['Change'])] + ".svg");

    },

    _refreshTimeout: function(sec) {
        Mainloop.source_remove(this.timeout);
        this.timeout = Mainloop.timeout_add_seconds(sec, Lang.bind(this, this.refreshData));
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
        this._preferences['verbose'] && 
            Util.spawnCommandLine("notify-send \"" + title + "\" \"" + msg + "\" -t " + t + " -u low -i emblem-marketing");
    }

};

function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(orientation, panel_height, instance_id);
}
