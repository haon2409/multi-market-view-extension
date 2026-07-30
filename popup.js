const DEFAULT_ITEMS = [
    { symbol: "VN30", source: "dnse" },
    { symbol: "^GSPC", source: "yahoo" } // ^GSPC là S&P 500 trên Yahoo
  ];
  
  let draggedCard = null;
  
  document.addEventListener("DOMContentLoaded", () => {
    loadAndRenderSymbols();
  
    document.getElementById("add-btn").addEventListener("click", addItem);
    document.getElementById("symbol-input").addEventListener("keypress", (e) => {
      if (e.key === "Enter") addItem();
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
        fetchSymbolData(item);
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
  
  function fetchSymbolData(item) {
    const { symbol, source } = item;
    const cardId = `card-${source}-${symbol.replace('^', '')}`;
  
    chrome.runtime.sendMessage({ action: "FETCH_OHLC", symbol, source }, (response) => {
      if (!response || !response.success || !response.data) return;
  
      let currentPrice = 0;
      let refPrice = 0;
      let prices = [];
  
      if (source === "yahoo") {
        // Parser dữ liệu Yahoo Finance JSON
        const result = response.data.chart?.result?.[0];
        if (!result) return;
  
        const meta = result.meta;
        refPrice = meta.chartPreviousClose || meta.previousClose;
        
        const rawPrices = result.indicators?.quote?.[0]?.close || [];
        prices = rawPrices.filter(p => p !== null && p !== undefined);
        
        currentPrice = meta.regularMarketPrice || prices[prices.length - 1];
      } else {
        // Parser dữ liệu DNSE
        const { t, c, o } = response.data;
        if (!t || !c || t.length === 0) return;
  
        const now = new Date();
        const startOfTodayTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
        let todayStartIndex = t.findIndex((time) => time >= startOfTodayTimestamp);
  
        if (todayStartIndex > 0) {
          refPrice = c[todayStartIndex - 1];
          prices = c.slice(todayStartIndex);
        } else if (todayStartIndex === 0) {
          refPrice = o[0];
          prices = c;
        } else {
          refPrice = c[c.length - 2] || c[0];
          prices = c;
        }
        currentPrice = prices[prices.length - 1];
      }
  
      // Tính toán chung
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
  
      // Render DOM
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
        drawSparkline(`canvas-${cardId}`, prices, colorClass === "red" ? "#ef5350" : "#26a69a");
      }
    });
  }
  
  function drawSparkline(canvasId, prices, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
  
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width || 90;
    canvas.height = rect.height || 32;
  
    const width = canvas.width;
    const height = canvas.height;
  
    ctx.clearRect(0, 0, width, height);
  
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
  
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
  
    prices.forEach((price, index) => {
      const x = prices.length === 1 ? width : (index / (prices.length - 1)) * width;
      const y = height - ((price - min) / range) * (height - 6) - 3;
  
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  
    ctx.stroke();
  
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = color === "#ef5350" ? "rgba(239, 83, 80, 0.15)" : "rgba(38, 166, 154, 0.15)";
    ctx.fill();
  }