// Hàm fetch dữ liệu DNSE đảm bảo luôn có đủ ít nhất 2 ngày giao dịch thực tế (khung 1D)
async function fetchDNSEData(symbol, resolution = "1", daysBack = 3, maxDays = 30) {
  const to = Math.floor(Date.now() / 1000);
  const now = new Date();
  
  // Kiểm tra giờ VN: Trước 9h00 sáng thì lùi thêm 1 ngày
  const hourVN = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false }).format(now));
  let currentDaysBack = daysBack;
  if (hourVN < 9) {
    currentDaysBack += 1;
  }

  if (currentDaysBack > maxDays) {
    throw new Error("Vượt quá giới hạn thời gian tìm kiếm dữ liệu (quá 30 ngày).");
  }

  const from = to - (currentDaysBack * 24 * 3600);
  const url = `https://api.dnse.com.vn/chart-api/v2/ohlcs/index?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data || !data.t || data.t.length === 0) {
      return await fetchDNSEData(symbol, resolution, currentDaysBack + 4, maxDays);
    }

    const dateOptions = { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' };
    const uniqueDates = new Set(data.t.map(ts => new Intl.DateTimeFormat('en-CA', dateOptions).format(new Date(ts * 1000))));

    if (uniqueDates.size < 2) {
      return await fetchDNSEData(symbol, resolution, currentDaysBack + 4, maxDays);
    }

    return data;
  } catch (err) {
    throw err;
  }
}

// Hàm fetch dữ liệu DNSE 1D (ngày), tự động ghép thêm giá realtime hôm nay từ nến 1 phút
async function fetchDNSEDataWithToday(symbol, daysBack = 90) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - (daysBack * 24 * 3600);
  const url = `https://api.dnse.com.vn/chart-api/v2/ohlcs/index?symbol=${symbol}&resolution=1D&from=${from}&to=${to}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data || !data.t || data.t.length === 0) return data;

  const dateOptions = { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' };
  const todayStr = new Intl.DateTimeFormat('en-CA', dateOptions).format(new Date());
  const lastDateStr = new Intl.DateTimeFormat('en-CA', dateOptions).format(new Date(data.t[data.t.length - 1] * 1000));

  // Nếu nến cuối của API 1D chưa có ngày hôm nay, gọi thêm nến 1 phút mới nhất của hôm nay để nối vào
  if (lastDateStr !== todayStr) {
    try {
      const todayData = await fetchDNSEData(symbol, "1", 1, 5);
      if (todayData && todayData.t && todayData.t.length > 0) {
        const todayLastDateStr = new Intl.DateTimeFormat('en-CA', dateOptions).format(new Date(todayData.t[todayData.t.length - 1] * 1000));
        if (todayLastDateStr === todayStr) {
          const latestPrice = todayData.c[todayData.c.length - 1];
          const latestTime = todayData.t[todayData.t.length - 1];
          data.t.push(latestTime);
          data.c.push(latestPrice);
          if (data.o) data.o.push(todayData.o[0]);
        }
      }
    } catch (e) {
      // Giữ nguyên dữ liệu 1D nếu vướng ngày nghỉ / lỗi mạng
    }
  }

  return data;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FETCH_OHLC") {
    const { symbol, source, timeframe } = request;

    if (source === "yahoo") {
      // --- NGUỒN YAHOO FINANCE ---
      const encodedSymbol = encodeURIComponent(symbol);
      
      let range = "1d";
      let interval = "2m";

      if (timeframe === "1W") {
        range = "1mo";
        interval = "1d"; // Lấy nến ngày để ghép đủ 5 ngày gần nhất (bao gồm hôm nay)
      } else if (timeframe === "1M") {
        range = "3mo";
        interval = "1d"; // Lấy nến ngày để ghép đủ 21 ngày gần nhất (bao gồm hôm nay)
      }

      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=${interval}&range=${range}`)
        .then(res => res.json())
        .then(data => sendResponse({ success: true, source: "yahoo", data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    } else {
      // --- NGUỒN DNSE (VIỆT NAM) ---
      if (timeframe === "1D") {
        fetchDNSEData(symbol, "1", 3, 30)
          .then(data => sendResponse({ success: true, source: "dnse", data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
      } else {
        const daysBack = timeframe === "1W" ? 90 : 365;
        fetchDNSEDataWithToday(symbol, daysBack)
          .then(data => sendResponse({ success: true, source: "dnse", data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
      }
    }
    return true; 
  }
});