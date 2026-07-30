chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "FETCH_OHLC") {
      const { symbol, source } = request;
  
      if (source === "yahoo") {
        // Gọi API Yahoo Finance Public
        // Chú ý: S&P 500 trên Yahoo là %5EGSPC (^GSPC)
        const encodedSymbol = encodeURIComponent(symbol);
        fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=2m&range=1d`)
          .then(res => res.json())
          .then(data => sendResponse({ success: true, source: "yahoo", data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
      } else {
        // Mặc định gọi API DNSE
        const to = Math.floor(Date.now() / 1000);
        const from = to - (4 * 24 * 3600);
  
        fetch(`https://api.dnse.com.vn/chart-api/v2/ohlcs/index?symbol=${symbol}&resolution=1&from=${from}&to=${to}`)
          .then(res => res.json())
          .then(data => sendResponse({ success: true, source: "dnse", data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
      }
      return true;
    }
  });