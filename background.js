// Hàm fetch dữ liệu DNSE đảm bảo luôn có đủ ít nhất 2 ngày giao dịch thực tế
async function fetchDNSEData(symbol, resolution = "1", daysBack = 3, maxDays = 30) {
  const to = Math.floor(Date.now() / 1000);
  const now = new Date();
  
  // 1. Kiểm tra giờ VN: Nếu trước 9h00 sáng (chưa mở cửa phiên hôm nay), nới thêm 1 ngày lùi
  const hourVN = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false }).format(now));
  let currentDaysBack = daysBack;
  if (hourVN < 9) {
    currentDaysBack += 1;
  }

  // ĐIỂM DỪNG ĐỆ QUY: Tránh lặp vô hạn nếu API lỗi hoặc mã cổ phiếu mới lên sàn chưa đủ dữ liệu
  if (currentDaysBack > maxDays) {
    throw new Error("Vượt quá giới hạn thời gian tìm kiếm dữ liệu (quá 30 ngày).");
  }

  const from = to - (currentDaysBack * 24 * 3600);
  const url = `https://api.dnse.com.vn/chart-api/v2/ohlcs/index?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    // 2. Nếu mảng rỗng (không có dữ liệu nào), nới rộng thêm 4 ngày và đệ quy
    if (!data || !data.t || data.t.length === 0) {
      return await fetchDNSEData(symbol, resolution, currentDaysBack + 4, maxDays);
    }

    // 3. Trích xuất danh sách các ngày thực tế có dữ liệu
    const dateOptions = { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' };
    const uniqueDates = new Set(data.t.map(ts => new Intl.DateTimeFormat('en-CA', dateOptions).format(new Date(ts * 1000))));

    // 4. Nếu chưa đủ 2 ngày (do vướng lễ/Tết dài ngày), nới rộng thêm 4 ngày và đệ quy
    if (uniqueDates.size < 2) {
      return await fetchDNSEData(symbol, resolution, currentDaysBack + 4, maxDays);
    }

    // Đã đủ điều kiện tối thiểu 2 ngày giao dịch
    return data;
  } catch (err) {
    throw err; // Truyền lỗi ra ngoài để khối catch của listener xử lý
  }
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
      // --- NGUỒN DNSE (VIỆT NAM) ---
      if (timeframe === "1D") {
        // Khung 1D: Sử dụng hàm lấy dữ liệu động, giới hạn max 30 ngày lùi
        fetchDNSEData(symbol, "1", 3, 30)
          .then(data => sendResponse({ success: true, source: "dnse", data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
      } else {
        // Khung 1W, 1M: Giữ nguyên logic tính toán cố định vì khung lớn ít bị ảnh hưởng bởi nghỉ lễ ngắn
        const to = Math.floor(Date.now() / 1000);
        let daysBack = timeframe === "1W" ? 90 : 365;
        let resolution = "1D";

        const from = to - (daysBack * 24 * 3600);

        fetch(`https://api.dnse.com.vn/chart-api/v2/ohlcs/index?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`)
          .then(res => res.json())
          .then(data => sendResponse({ success: true, source: "dnse", data }))
          .catch(err => sendResponse({ success: false, error: err.message }));
      }
    }
    // Bắt buộc return true để giữ cổng kết nối mở cho xử lý bất đồng bộ (async/await)
    return true; 
  }
});