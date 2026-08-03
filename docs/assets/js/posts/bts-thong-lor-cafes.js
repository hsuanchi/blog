(() => {
  "use strict";

  const ORIGIN = { lat: 13.7242, lng: 100.57857 };
  const MAP_BOUNDS = { left: 13075451.652286697, right: 13076214.133464627, top: 7742564.8635697365, bottom: 7743327.344747664 };
  const MAP_ZOOM = 16;
  const TILE_SIZE = 256;
  const TOPIC_LABELS = { coffee: "咖啡", service: "服務", atmosphere: "環境", food: "餐食", price: "價格" };
  const LANGUAGE_LABELS = { latin: "拉丁字母", th: "泰文", zh: "中文", ja: "日文", ko: "韓文", other: "其他" };
  const reviewState = new Map();
  const embeddedReviews = window.BTS_THONG_LOR_REVIEWS || {};
  let cafes = [];
  let previews = {};
  let openRank = null;

  const number = (value) => Number(value || 0).toLocaleString();
  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  const escapeAttr = escapeHtml;

  function googleMapsUrl(cafe) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(cafe.name) + "&query_place_id=" + encodeURIComponent(cafe.placeId);
  }

  function walkingUrl(cafe) {
    const destination = cafe.lat !== undefined && cafe.lng !== undefined ? cafe.lat + "," + cafe.lng : cafe.name;
    return "https://www.google.com/maps/dir/?api=1&origin=" + ORIGIN.lat + "," + ORIGIN.lng + "&destination=" + encodeURIComponent(destination) + "&travelmode=walking";
  }

  function estimatedWalk(cafe) {
    if (cafe.lat === undefined || cafe.lng === undefined) return null;
    const radius = 6371;
    const toRad = (degrees) => degrees * Math.PI / 180;
    const deltaLat = toRad(cafe.lat - ORIGIN.lat);
    const deltaLng = toRad(cafe.lng - ORIGIN.lng);
    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRad(ORIGIN.lat)) * Math.cos(toRad(cafe.lat)) * Math.sin(deltaLng / 2) ** 2;
    const distanceKm = radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.max(1, Math.round((distanceKm * 1.28) / 0.08));
  }

  function mapPosition(lat, lng) {
    const scale = TILE_SIZE * 2 ** MAP_ZOOM;
    const x = ((lng + 180) / 360) * scale;
    const sinLat = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
    return { left: ((x - MAP_BOUNDS.left) / (MAP_BOUNDS.right - MAP_BOUNDS.left)) * 100, top: ((y - MAP_BOUNDS.top) / (MAP_BOUNDS.bottom - MAP_BOUNDS.top)) * 100 };
  }

  function languageMark(text) {
    if (/\p{Script=Thai}/u.test(text)) return "🇹🇭";
    if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return "🇯🇵";
    if (/\p{Script=Hangul}/u.test(text)) return "🇰🇷";
    if (/\p{Script=Han}/u.test(text)) return "中文";
    return "EN";
  }

  function stabilityLabel(value) {
    if (value <= 0.35) return "非常穩定";
    if (value <= 0.65) return "穩定";
    if (value <= 0.95) return "稍有分歧";
    return "評價兩極";
  }

  function signalClass(value) {
    if (value >= 60) return "signal-high";
    if (value >= 30) return "signal-mid";
    return "signal-low";
  }

  function percentBar(label, value, count, tone = "brown") {
    const countText = count === undefined ? "" : "<small>" + number(count) + " 則</small>";
    return '<div class="percent-row"><div class="percent-label"><span>' + escapeHtml(label) + countText + '</span><strong>' + value + '%</strong></div><div class="percent-track ' + tone + '"><i style="width:' + Math.min(100, value) + '%"></i></div></div>';
  }

  function metric(value, label, note) {
    return '<div class="bento-cell bento-num"><strong>' + escapeHtml(value) + '</strong><b>' + escapeHtml(label) + '</b><span>' + escapeHtml(note) + '</span></div>';
  }

  function starPanel(cafe) {
    const rows = [5, 4, 3, 2, 1].map((star) => {
      const count = cafe.starDistribution[String(star)] || 0;
      return percentBar(star + " 星", Math.round(count / cafe.fetchedReviews * 100));
    }).join("");
    return '<div class="bento-cell bento-stars"><h4>星級分布</h4>' + rows + '<p class="panel-note">均分 ' + cafe.rating.toFixed(2) + ' · 離散度 ' + cafe.stdev.toFixed(2) + '</p></div>';
  }

  function topicPanel(cafe) {
    const rows = Object.entries(cafe.topics).sort((a, b) => b[1].count - a[1].count).slice(0, 4).map(([key, item]) => percentBar(TOPIC_LABELS[key], item.pct, item.count)).join("");
    return '<div class="bento-cell bento-topics"><h4>話題分布</h4>' + rows + '<p class="panel-note">分母為 ' + number(cafe.textReviews) + ' 則含文字評論，同一則可同時提到多個主題。</p></div>';
  }

  function languagePanel(cafe) {
    const rows = Object.entries(cafe.languages).filter(([, item]) => item.count).sort((a, b) => b[1].count - a[1].count).slice(0, 4).map(([key, item]) => '<div class="language-line"><span>' + LANGUAGE_LABELS[key] + '</span><strong>' + item.pct + '%</strong><small>' + number(item.count) + ' 則</small></div>').join("");
    return '<div class="bento-cell bento-nation language-panel"><h4>評論文字語系</h4>' + rows + '<p class="panel-note">只判斷文字系統，不推定評論者國籍。</p></div>';
  }

  function negativePanel(cafe) {
    const negatives = Object.entries(cafe.negativeTopics).filter(([, item]) => item.count).sort((a, b) => b[1].count - a[1].count).slice(0, 2);
    const stats = '<div><strong>' + cafe.negativeRate + '%</strong><span>負評率</span></div>' + negatives.map(([key, item]) => '<div><strong>' + item.pct + '%</strong><span>罵' + TOPIC_LABELS[key] + '</span></div>').join("");
    const note = cafe.lowTextReviews ? number(cafe.lowTextReviews) + " 則低分文字評論可分析。" : "沒有足夠的低分文字評論可分析。";
    return '<section class="bento-cell bento-neg-xray negative-xray"><h4>負評 X 光</h4><div class="negative-stats">' + stats + '</div><p>' + note + '</p></section>';
  }

  function reviewItem(review) {
    const low = review.rating <= 2 ? " review-low" : "";
    const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
    const text = review.text && review.text.trim() ? review.text.trim() : "（此評論只有星等，沒有留下文字。）";
    return '<article class="review-item' + low + '"><div class="review-meta"><span>' + languageMark(text) + ' · ' + stars + '</span><time>' + escapeHtml(review.when || "Google 評論") + '</time></div><p>' + escapeHtml(text) + '</p><footer>— ' + escapeHtml(review.author || "Google 使用者") + '</footer></article>';
  }

  function reviewsBlock(cafe) {
    const featured = previews[String(cafe.rank)]?.featured || [];
    return '<section class="reviews-block" aria-label="' + escapeAttr(cafe.name) + ' 的評論" data-review-block="' + cafe.rank + '"><div class="reviews-title">關於這裡，他們這樣說：</div><div class="reviews-list">' + featured.map(reviewItem).join("") + '</div><button class="more-reviews" type="button" data-expand-reviews="' + cafe.rank + '">展開更多 · 共 ' + number(cafe.fetchedReviews) + ' 則評論 ▼</button><div class="reviews-status"></div></section>';
  }

  function cafeCard(cafe) {
    const fiveStarPct = Math.round((cafe.starDistribution["5"] || 0) / cafe.fetchedReviews * 100);
    const walk = estimatedWalk(cafe);
    const footerWalk = walk === null ? "" : '<small>從 BTS Thong Lor Station 預估步行約 ' + walk + ' 分鐘</small>';
    const negative = previews[String(cafe.rank)]?.negative;
    const negativeHtml = negative ? '<section class="neg-section"><div class="reviews-title">也有人這樣說（1–2 星占 ' + cafe.negativeRate + '%）：</div>' + reviewItem(negative) + '</section>' : "";
    return '<article class="shop cafe-card" id="item-' + cafe.rank + '">' +
      '<header class="shop-top cafe-head"><div class="rank-number">' + cafe.rank + '</div><div class="cafe-heading"><h3>' + escapeHtml(cafe.name) + '</h3><div>⭐ ' + cafe.rating.toFixed(1) + ' · ' + number(cafe.fetchedReviews) + ' 則已抓取評論</div><p>' + escapeHtml(cafe.summary) + '</p></div></header>' +
      '<div class="bento">' + metric(cafe.coffeeSignal + '%', "咖啡信號", number(cafe.topics.coffee.count) + " 則評論聊咖啡") + metric(cafe.stdev.toFixed(2), "品質穩定度", stabilityLabel(cafe.stdev)) + metric(fiveStarPct + '%', "五星密度", number(cafe.starDistribution["5"] || 0) + " 人給五星") + metric(cafe.recommendationRate + '%', "推薦強度", number(cafe.recommendationCount) + " 則明確推薦") + starPanel(cafe) + topicPanel(cafe) + languagePanel(cafe) + negativePanel(cafe) + '<div class="bento-cell bento-insight">' + number(cafe.fetchedReviews) + ' 則評論中，' + number(cafe.topics.coffee.count) + ' 則聊咖啡，' + number(cafe.recommendationCount) + ' 則出現明確推薦語句。</div></div>' +
      reviewsBlock(cafe) + '<div class="review-summary">' + number(cafe.fetchedReviews) + ' 則評論中，' + number(cafe.topics.coffee.count) + ' 則聊咖啡，' + number(cafe.recommendationCount) + ' 則出現明確推薦語句。</div>' + negativeHtml +
      '<div class="verdict-grid"><div><strong>👍 好評重點</strong><p>' + escapeHtml(cafe.strength) + '</p></div><div><strong>⚠️ 要注意</strong><p>' + escapeHtml(cafe.caution) + '</p></div></div>' +
      '<div class="coverage-note">資料覆蓋：實際抓取 ' + number(cafe.fetchedReviews) + ' / Google 顯示 ' + number(cafe.expectedReviews) + ' 則（' + cafe.coverage + '%）</div>' +
      '<footer class="cafe-footer"><div><span>⌖</span>' + escapeHtml(cafe.address || "地址請見 Google Maps") + footerWalk + '</div><nav><a href="' + walkingUrl(cafe) + '" target="_blank" rel="noreferrer">步行路線 ↗</a><a class="solid" href="' + googleMapsUrl(cafe) + '" target="_blank" rel="noreferrer">Google Maps →</a></nav></footer></article>';
  }

  function renderMap() {
    const canvas = document.getElementById("map-canvas");
    const origin = mapPosition(ORIGIN.lat, ORIGIN.lng);
    canvas.insertAdjacentHTML("beforeend", '<a class="origin-marker" style="left:' + origin.left + '%;top:' + origin.top + '%" href="#ranking" aria-label="BTS Thong Lor Station 起點"><i></i>BTS Thong Lor Station</a>');
    const mapped = cafes.filter((cafe) => cafe.lat !== undefined && cafe.lng !== undefined);
    mapped.forEach((cafe) => {
      const point = mapPosition(cafe.lat, cafe.lng);
      const size = 32 + Math.log10(cafe.fetchedReviews + 1) * 6;
      canvas.insertAdjacentHTML("beforeend", '<a href="#item-' + cafe.rank + '" class="map-marker ' + signalClass(cafe.coffeeSignal) + '" style="left:' + point.left + '%;top:' + point.top + '%;width:' + size + 'px;height:' + size + 'px" aria-label="第 ' + cafe.rank + ' 名 ' + escapeAttr(cafe.name) + '"><span>' + cafe.rank + '</span><b>#' + cafe.rank + ' ' + escapeHtml(cafe.name) + '<small>⭐ ' + cafe.rating.toFixed(1) + ' · 咖啡信號 ' + cafe.coffeeSignal + '%</small></b></a>');
    });
    [1, 3, 4, 9, 15, 20].forEach((rank) => {
      const cafe = cafes.find((item) => item.rank === rank);
      if (!cafe) return;
      canvas.insertAdjacentHTML("beforeend", '<a class="map-callout callout-' + cafe.rank + '" href="#item-' + cafe.rank + '"><strong>#' + cafe.rank + ' ' + escapeHtml(cafe.name) + '</strong><span>⭐' + cafe.rating.toFixed(1) + ' · ' + number(cafe.fetchedReviews) + '則 · 咖啡信號 ' + cafe.coffeeSignal + '%</span></a>');
    });

    const signalTop = [...cafes].sort((a, b) => b.coffeeSignal - a.coffeeSignal).slice(0, 3);
    document.getElementById("signal-top").innerHTML = signalTop.map((cafe) => '<li><a href="#item-' + cafe.rank + '">#' + cafe.rank + ' ' + escapeHtml(cafe.name) + '</a><strong>' + cafe.coffeeSignal + '%</strong></li>').join("");

    const closest = cafes.filter((cafe) => estimatedWalk(cafe) !== null).sort((a, b) => estimatedWalk(a) - estimatedWalk(b)).slice(0, 3);
    document.getElementById("closest-cafes").innerHTML = closest.map((cafe) => '<li><a href="#item-' + cafe.rank + '">' + escapeHtml(cafe.name) + '</a><strong>約 ' + estimatedWalk(cafe) + ' 分</strong></li>').join("");

    const counts = {};
    cafes.forEach((cafe) => Object.entries(cafe.languages).forEach(([key, value]) => counts[key] = (counts[key] || 0) + value.count));
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    document.getElementById("language-totals").innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, count]) => '<div><span>' + LANGUAGE_LABELS[key] + '</span><strong>' + Math.round(count / total * 100) + '%</strong></div>').join("");
  }

  function moreRow(cafe) {
    const topLanguage = Object.entries(cafe.languages).sort((a, b) => b[1].count - a[1].count)[0];
    const open = openRank === cafe.rank;
    return '<div class="more-item' + (open ? " open" : "") + '" data-more-item="' + cafe.rank + '"><button type="button" class="more-row" aria-expanded="' + open + '" data-open-cafe="' + cafe.rank + '"><span class="more-rank">#' + cafe.rank + '</span><span class="more-name">' + escapeHtml(cafe.name) + '<small>⭐ ' + cafe.rating.toFixed(1) + ' · ' + number(cafe.fetchedReviews) + ' 則</small></span><strong>' + cafe.coffeeSignal + '%<small>咖啡信號</small></strong><span class="more-language">' + LANGUAGE_LABELS[topLanguage[0]] + ' ' + topLanguage[1].pct + '%</span><p>' + escapeHtml(cafe.summary) + '</p><i>' + (open ? "收合" : "展開") + '</i></button>' + (open ? cafeCard(cafe) : "") + '</div>';
  }

  function renderRanking() {
    document.getElementById("top-five").innerHTML = cafes.slice(0, 5).map(cafeCard).join("");
    document.getElementById("more-list").innerHTML = cafes.slice(5).map(moreRow).join("");
  }

  function rerenderMore() {
    document.getElementById("more-list").innerHTML = cafes.slice(5).map(moreRow).join("");
  }

  function loadReviews(rank) {
    const block = document.querySelector('[data-review-block="' + rank + '"]');
    if (!block) return;
    const button = block.querySelector("[data-expand-reviews]");
    const status = block.querySelector(".reviews-status");
    if (button) button.remove();
    status.className = "reviews-status reviews-loading";
    status.textContent = "正在載入全部評論…";
    try {
      const payload = embeddedReviews[String(rank)];
      if (!payload || !Array.isArray(payload.reviews)) throw new Error("review data unavailable");
      reviewState.set(rank, { reviews: payload.reviews || [], page: 0 });
      renderReviewPage(rank);
    } catch (error) {
      status.className = "reviews-status reviews-error";
      status.textContent = "評論資料載入失敗，請重新整理頁面再試。";
    }
  }

  function renderReviewPage(rank) {
    const state = reviewState.get(rank);
    const block = document.querySelector('[data-review-block="' + rank + '"]');
    if (!state || !block) return;
    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(state.reviews.length / pageSize));
    state.page = Math.max(0, Math.min(pageCount - 1, state.page));
    const shown = state.reviews.slice(state.page * pageSize, (state.page + 1) * pageSize);
    block.querySelector(".reviews-list").classList.add("expanded");
    block.querySelector(".reviews-list").innerHTML = shown.map(reviewItem).join("");
    const status = block.querySelector(".reviews-status");
    status.className = "reviews-status";
    status.innerHTML = '<div class="review-pager"><span>第 ' + (state.page + 1) + '/' + pageCount + ' 頁 · 每頁 ' + pageSize + ' 則</span><div><button type="button" data-review-page="' + rank + '" data-delta="-1"' + (state.page === 0 ? " disabled" : "") + '>上一頁</button><button type="button" data-review-page="' + rank + '" data-delta="1"' + (state.page >= pageCount - 1 ? " disabled" : "") + '>下一頁</button></div></div>';
  }

  document.addEventListener("click", (event) => {
    const cafeButton = event.target.closest("[data-open-cafe]");
    if (cafeButton) {
      const rank = Number(cafeButton.dataset.openCafe);
      openRank = openRank === rank ? null : rank;
      rerenderMore();
      if (openRank) setTimeout(() => document.getElementById("item-" + openRank)?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
      return;
    }
    const reviewButton = event.target.closest("[data-expand-reviews]");
    if (reviewButton) {
      loadReviews(Number(reviewButton.dataset.expandReviews));
      return;
    }
    const pageButton = event.target.closest("[data-review-page]");
    if (pageButton) {
      const rank = Number(pageButton.dataset.reviewPage);
      const state = reviewState.get(rank);
      if (!state) return;
      state.page += Number(pageButton.dataset.delta);
      renderReviewPage(rank);
      document.querySelector('[data-review-block="' + rank + '"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  try {
    const analysis = window.BTS_THONG_LOR_DATA;
    const previewData = window.BTS_THONG_LOR_PREVIEWS;
    if (!analysis || !Array.isArray(analysis.cafes) || !previewData) throw new Error("embedded data unavailable");
    cafes = analysis.cafes;
    previews = previewData;
    renderMap();
    renderRanking();
    document.getElementById("site-footer").innerHTML = '<p>資料來源：Google Maps 公開評論</p><p>評論數：實際抓取 ' + number(analysis.totals.fetchedReviews) + ' / Google 顯示 ' + number(analysis.totals.expectedReviews) + ' 則，其中 ' + number(analysis.totals.textReviews) + ' 則含文字</p><p>營業資訊以各店最新公告為準，本頁評論分析與車站步行時間估算僅供參考。</p>';
  } catch (error) {
    const status = document.querySelector("#top-five .data-status");
    if (status) { status.classList.add("error"); status.textContent = "咖啡資料載入失敗，請確認資料檔與本頁放在同一資料夾。"; }
  }
})();
