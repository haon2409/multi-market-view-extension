const DEFAULT_ITEMS = [
  { symbol: "VN30", source: "dnse" },
  { symbol: "^GSPC", source: "yahoo" }
];

let currentTimeframe = "1D";
let draggedCard = null;

document.addEventListener("DOMContentLoaded", () => {
  loadAndRenderSymbols();

  document.getElementById("add-btn").addEventListener("click", addItem);
  document.getElementById("symbol-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") addItem();
  });

  // Bắt sự kiện chuyển đổi 1D / 1W
  document.querySelectorAll(".tf-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".tf-btn").forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      currentTimeframe = e.target.getAttribute("data-tf");
      loadAndRenderSymbols();
    });
  });
});

function loadAndRenderSymbols() {
  chrome.storage.local.get(["watchedItems"], (result) => {
    let items = result.watchedItems;
    if (!items || items.length === 0) {
      items = DEFAULT_ITEMS;
      chrome.storage.local.set({ watchedItems: items });
    }

    const container = document.getElementById("symbols-container");
    container.innerHTML = "";

    items.forEach((item) => {
      createSymbolCard(item, container);
      fetchSymbolData(item, currentTimeframe);
    });
  });
}

function addItem() {
  const input = document.getElementById("symbol-input");
  const sourceSelect = document.getElementById("source-select");
  
  const symbol = input.value.trim().toUpperCase();
  const source = sourceSelect.value;

  if (!symbol) return;

  chrome.storage.local.get(["watchedItems"], (result) => {
    let items = result.watchedItems || DEFAULT_ITEMS;
    const exists = items.some(i => i.symbol === symbol && i.source === source);

    if (!exists) {
      items.push({ symbol, source });
      chrome.storage.local.set({ watchedItems: items }, () => {
        loadAndRenderSymbols();
        input.value = "";
      });
    } else {
      input.value = "";
    }
  });
}

function deleteItem(symbol, source) {
  chrome.storage.local.get(["watchedItems"], (result) => {
    let items = result.watchedItems || [];
    items = items.filter((i) => !(i.symbol === symbol && i.source === source));
    chrome.storage.local.set({ watchedItems: items }, () => {
      loadAndRenderSymbols();
    });
  });
}

function saveNewOrder() {
  const cards = document.querySelectorAll("#symbols-container .card");
  const newItemsOrder = Array.from(cards).map((card) => ({
    symbol: card.getAttribute("data-symbol"),
    source: card.getAttribute("data-source")
  }));
  
  chrome.storage.local.set({ watchedItems: newItemsOrder });
}

function createSymbolCard(item, container) {
  const { symbol, source } = item;
  const cardId = `card-${source}-${symbol.replace('^', '')}`;

  const card = document.createElement("div");
  card.className = "card";
  card.id = cardId;
  card.setAttribute("data-symbol", symbol);
  card.setAttribute("data-source", source);
  card.setAttribute("draggable", "true");

  card.innerHTML = `
    <div class="header">
      <div class="symbol-group">
        <span class="drag-handle" title="Kéo để sắp xếp">⋮⋮</span>
        <span class="symbol">${symbol}</span>
        <span class="badge ${source}">${source}</span>
        <button class="delete-btn" title="Xóa" data-symbol="${symbol}" data-source="${source}">✕</button>
      </div>
      <div class="changes">
        <span id="percent-${cardId}" class="yellow">--%</span>
        <span id="point-${cardId}" class="yellow">--</span>
      </div>
    </div>
    <div class="footer">
      <div id="price-${cardId}" class="price yellow">0.00</div>
      <div class="chart-container">
        <canvas id="canvas-${cardId}" width="90" height="32"></canvas>
      </div>
    </div>
  `;

  container.appendChild(card);

  card.querySelector(".delete-btn").addEventListener("click", (e) => {
    const sym = e.target.getAttribute("data-symbol");
    const src = e.target.getAttribute("data-source");
    deleteItem(sym, src);
  });

  // Gắn sự kiện click mở web
  card.querySelector(".symbol").addEventListener("click", () => {
    openSymbolWebpage(symbol, source);
  });

  addDragAndDropEvents(card, container);
}

function addDragAndDropEvents(card, container) {
  card.addEventListener("dragstart", (e) => {
    draggedCard = card;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    document.querySelectorAll(".card").forEach((c) => c.classList.remove("drag-over"));
    draggedCard = null;
    saveNewOrder();
  });

  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (card !== draggedCard) card.classList.add("drag-over");
  });

  card.addEventListener("dragleave", () => {
    card.classList.remove("drag-over");
  });

  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("drag-over");

    if (draggedCard && draggedCard !== card) {
      const allCards = Array.from(container.children);
      const draggedIndex = allCards.indexOf(draggedCard);
      const targetIndex = allCards.indexOf(card);

      if (draggedIndex < targetIndex) {
        container.insertBefore(draggedCard, card.nextSibling);
      } else {
        container.insertBefore(draggedCard, card);
      }
    }
  });
}

function fetchSymbolData(item, timeframe = "1D") {
  const { symbol, source } = item;
  const cardId = `card-${source}-${symbol.replace('^', '')}`;

  chrome.runtime.sendMessage({ action: "FETCH_OHLC", symbol, source, timeframe }, (response) => {
    if (!response || !response.success || !response.data) return;

    let currentPrice = 0;
    let refPrice = 0;
    let prices = [];

    if (source === "yahoo") {
      // --- XỬ LÝ NGUỒN YAHOO FINANCE ---
      const result = response.data.chart?.result?.[0];
      if (!result) return;

      const meta = result.meta;
      const rawPrices = result.indicators?.quote?.[0]?.close || [];
      const validPrices = rawPrices.filter(p => p !== null && p !== undefined);

      currentPrice = meta.regularMarketPrice || validPrices[validPrices.length - 1];

      if (timeframe === "1M") {
        // Tháng: Lấy 21 nến ngày gần nhất (~1 tháng giao dịch)
        prices = validPrices.slice(-21);
        refPrice = validPrices.length >= 22 ? validPrices[validPrices.length - 22] : validPrices[0];
      } else if (timeframe === "1W") {
        // Tuần: Lấy 5 nến ngày gần nhất
        prices = validPrices.slice(-5);
        refPrice = validPrices.length >= 6 ? validPrices[validPrices.length - 6] : validPrices[0];
      } else {
        // Ngày: Lấy nến trong ngày
        prices = validPrices;
        refPrice = meta.chartPreviousClose || meta.previousClose;
      }
    } else {
      // --- XỬ LÝ NGUỒN DNSE ---
      const { t, c, o } = response.data;
      if (!t || !c || t.length === 0) return;

      if (timeframe === "1M") {
        // --- KHUNG THÁNG (1M) ---
        currentPrice = c[c.length - 1];

        // 1. Giá tham chiếu = Giá đóng cửa trước đó khoảng 21 phiên giao dịch (~1 tháng)
        refPrice = c.length > 21 ? c[c.length - 22] : c[0];

        // 2. Lấy 21 nến gần nhất đại diện cho 1 tháng để vẽ Sparkline
        prices = c.slice(-21);
      } else if (timeframe === "1W") {
        // --- KHUNG TUẦN (1W) ---
        currentPrice = c[c.length - 1];

        // Giá tham chiếu = Giá đóng cửa của phiên Thứ 6 tuần trước (lùi 5 phiên)
        refPrice = c.length > 5 ? c[c.length - 6] : c[0];

        // Lấy 5 nến gần nhất của tuần này để vẽ Sparkline
        prices = c.slice(-5);
      } else {
        // --- KHUNG NGÀY (1D) ---
        const options = { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' };
        const todayStr = new Intl.DateTimeFormat('en-CA', options).format(new Date());

        const dateStrings = t.map(ts => new Intl.DateTimeFormat('en-CA', options).format(new Date(ts * 1000)));
        const latestDateStr = dateStrings[dateStrings.length - 1];

        if (latestDateStr === todayStr) {
          const todayIndices = [];
          const pastIndices = [];

          dateStrings.forEach((dStr, idx) => {
            if (dStr === todayStr) todayIndices.push(idx);
            else pastIndices.push(idx);
          });

          prices = todayIndices.map(i => c[i]);
          currentPrice = prices[prices.length - 1];
          refPrice = pastIndices.length > 0 ? c[pastIndices[pastIndices.length - 1]] : o[todayIndices[0]];
        } else {
          const latestDayIndices = [];
          const previousDayIndices = [];

          dateStrings.forEach((dStr, idx) => {
            if (dStr === latestDateStr) latestDayIndices.push(idx);
            else previousDayIndices.push(idx);
          });

          prices = latestDayIndices.map(i => c[i]);
          currentPrice = prices[prices.length - 1];
          refPrice = previousDayIndices.length > 0 ? c[previousDayIndices[previousDayIndices.length - 1]] : o[latestDayIndices[0]];
        }
      }
    }

    // --- TÍNH TOÁN ĐIỂM VÀ % TĂNG/GIẢM ---
    const change = currentPrice - refPrice;
    const changePercent = refPrice ? (change / refPrice) * 100 : 0;

    let colorClass = "yellow";
    let prefix = "";
    if (change > 0) {
      colorClass = "green";
      prefix = "+";
    } else if (change < 0) {
      colorClass = "red";
    }

    // --- CẬP NHẬT GIAO DIỆN HTML ---
    const priceEl = document.getElementById(`price-${cardId}`);
    if (priceEl) {
      priceEl.textContent = currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      priceEl.className = `price ${colorClass}`;
    }

    const pointEl = document.getElementById(`point-${cardId}`);
    if (pointEl) {
      pointEl.textContent = `${prefix}${change.toFixed(2)}`;
      pointEl.className = colorClass;
    }

    const percentEl = document.getElementById(`percent-${cardId}`);
    if (percentEl) {
      percentEl.textContent = `${prefix}${changePercent.toFixed(2)}%`;
      percentEl.className = colorClass;
    }

    if (prices.length > 0) {
      drawSparkline(`canvas-${cardId}`, prices, refPrice);
    }
  });
}

function drawSparkline(canvasId, prices, refPrice) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width || 90;
  canvas.height = rect.height || 32;

  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  // 1. Đưa giá tham chiếu vào để tính toán min/max, đảm bảo trục Y chuẩn xác
  const min = Math.min(...prices, refPrice);
  const max = Math.max(...prices, refPrice);
  const range = max - min || 1;

  // 2. Tính toạ độ Y của giá tham chiếu và tỷ lệ % trên canvas
  const baselineY = height - ((refPrice - min) / range) * (height - 6) - 3;
  const stopPercent = Math.max(0, Math.min(1, baselineY / height));

  // 3. Tạo Gradient cho đường Line (Cắt màu sắc nét tại đúng baseline)
  const strokeGradient = ctx.createLinearGradient(0, 0, 0, height);
  strokeGradient.addColorStop(0, "#26a69a"); // Xanh cho phần trên
  strokeGradient.addColorStop(stopPercent, "#26a69a");
  strokeGradient.addColorStop(stopPercent, "#ef5350"); // Đỏ cho phần dưới
  strokeGradient.addColorStop(1, "#ef5350");

  // 4. Tạo Gradient cho vùng Fill (Hiệu ứng mờ dần về baseline)
  const fillGradient = ctx.createLinearGradient(0, 0, 0, height);
  fillGradient.addColorStop(0, "rgba(38, 166, 154, 0.25)");
  fillGradient.addColorStop(stopPercent, "rgba(38, 166, 154, 0)");
  fillGradient.addColorStop(stopPercent, "rgba(239, 83, 80, 0)");
  fillGradient.addColorStop(1, "rgba(239, 83, 80, 0.25)");

  // 5. Vẽ đường
  ctx.beginPath();
  ctx.strokeStyle = strokeGradient;
  ctx.lineWidth = 1.5;

  prices.forEach((price, index) => {
    const x = prices.length === 1 ? width : (index / (prices.length - 1)) * width;
    const y = height - ((price - min) / range) * (height - 6) - 3;

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 6. Đổ màu nền (Area)
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = fillGradient;
  ctx.fill();
}

// Hàm tạo URL dựa theo nguồn và mã giao dịch
function openSymbolWebpage(symbol, source) {
  let url = "";
  if (source === "yahoo") {
    url = `https://finance.yahoo.com/quote/${symbol}`;
  } else {
    const symLower = symbol.toLowerCase();
    // Xử lý riêng cho các chỉ số thị trường chung mở sang bảng giá niêm yết
    if (["vn30", "hose", "hnx", "upcom"].includes(symLower)) {
      url = `https://banggia.dnse.com.vn/v2/niem-yet/${symLower}`;
    } else if (symLower === "vnindex") {
      url = `https://banggia.dnse.com.vn/v2/niem-yet/hose`;
    } else {
      // Các mã cổ phiếu cụ thể mở trang tổng quan mã
      url = `https://banggia.dnse.com.vn/tong-quan-ma/${symLower}`;
    }
  }
  // Dùng chrome.tabs.create để mở tab mới an toàn trong Extension
  chrome.tabs.create({ url: url });
}