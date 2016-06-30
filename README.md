# Cinnamon-applet-watchlist

*Watchlist* [Cinnamon](https://en.wikipedia.org/wiki/Cinnamon_%28software%29) applet retrieves and displays stock quotes and indexes from Yahoo! Finance and Google Finance.

Quotes may be delayed by 15 minutes. 

*Watchlist* is tested on Cinnamon 3.0.6.

## Screenshots
#### Quote on the panel
![Quote](https://cloud.githubusercontent.com/assets/6327275/13592380/a721f498-e4bf-11e5-85f3-8904147ffe35.png)
#### Drop-down list 
Click a stock/index to open charts in the browser.

![Watchlist](https://cloud.githubusercontent.com/assets/6327275/13592440/0f086fc4-e4c0-11e5-9d1e-02a8d6d93821.png)
#### Settings
![Settings](https://cloud.githubusercontent.com/assets/6327275/13592381/a7384a90-e4bf-11e5-8528-8f504ef9f5a6.png)

## Setup your watchlist/portfolio
To setup a watchlist/portfolio, type symbols and positions in the following format 

```
Symbol1,#Shares1;Symbol2,#Shares2;Symbol3;Symbol4...
```
in the settings. For example, ``VTI,10;VEU,0;MUB,5;JNK;GLD`` means the portfolio formed by 10 shares of *VTI*, 0 share of *VEU*, and 5 shares of *MUB* as well as *JNK* and *GLD* included in the list.

All positions must be priced in the same currency to obtain the correct value in the portfolio. 

## Display indexes
Select the following indexes in cinnamon-settings to display in the drop-down list:

  - S&P 500 Index
  - Dow Jones Industrial Average (available only with Google Finance)
  - Nasdaq Composite
  - CBOE Volatility Index
  - CBOE Interest Rate 10 Year T-Note

## Installation
Copy the folder ``watchlist@yjwu`` to `$HOME/.local/share/cinnamon/applets/` and enable *Watchlist* in `cinnamon-settings applets`.

