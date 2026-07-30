chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FETCH_OHLC") {
    const { symbol, source, timeframe } = request; // timeframe: '1D', '1W', '1M'

    if (source === "yahoo") {
      const encodedSymbol = encodeURIComponent(symbol);
      
      let range = "1d";
      let interval = "2m";

      if (timeframe === "1W") {
        range = "1y";
        interval = "1wk";
      } else if (timeframe === "1M") {
        range = "2y";
        interval = "1mo";
      }

      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=${interval}&range=${range}`)
        .then(res => res.json())
        .then(data => sendResponse({ success: true, source: "yahoo", data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    } else {
      // Mặc định DNSE
      const to = Math.floor(Date.now() / 1000);
      
      let daysBack = 4;
      let resolution = "1";

      if (timeframe === "1W") {
        daysBack = 90;
        resolution = "1D";
      } else if (timeframe === "1M") {
        daysBack = 365;
        resolution = "1D";
      }

      const from = to - (daysBack * 24 * 3600);

      fetch(`https://api.dnse.com.vn/chart-api/v2/ohlcs/index?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`)
        .then(res => res.json())
        .then(data => sendResponse({ success: true, source: "dnse", data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    }
    return true;
  }
});