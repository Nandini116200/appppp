/*
  M.R Milk app main JavaScript file.

  Is file ka kaam:
  - Screen navigation handle karna.
  - Login/register/OTP/profile data manage karna.
  - Cart, wishlist, orders, subscriptions aur delivery controls chalana.
  - Supabase ke saath user-specific data sync karna.
  - Payment screens, QR timer, notifications aur badges update karna.

  Debugging tip:
  - Agar UI screen change issue hai to "SCREEN NAVIGATION" search karo.
  - Agar login/profile issue hai to "AUTH AND PROFILE" search karo.
  - Agar cart/wishlist/order sync issue hai to "SUPABASE USER DATA SYNC" search karo.
  - Agar payment issue hai to "PAYMENT FLOW" search karo.
*/

/* ================= USER-SCOPED LOCAL STORAGE =================
   Same browser/app me multiple users login kar sakte hain.
   Is block ka kaam selected localStorage keys ko user ke mobile/email ke hisaab se
   separate rakhna hai, taki ek user ka cart/wishlist dusre user ko na dikhe.
*/
const USER_SCOPED_STORAGE_KEYS = new Set([
  'cart',
  'selectedCartItems',
  'wishlist',
  'addresses',
  'selectedDeliveryAddressId',
  'savedCards',
  'savedUpis',
  'placedOrders',
  'placedOrdersDetailBackup',
  'milkCashTransactions',
  'subscribedProducts',
  'viewedProducts',
  'dismissedNotifications',
  'deliveryControlsByProduct',
  'buyNowItem'
]);

const rawStorageGetItem = Storage.prototype.getItem;
const rawStorageSetItem = Storage.prototype.setItem;
const rawStorageRemoveItem = Storage.prototype.removeItem;

function getCurrentUserStorageKey() {
  const loggedIn =
    rawStorageGetItem.call(localStorage, 'isLoggedIn') === 'true';

  if (!loggedIn) return '__guest__';

  return (
    rawStorageGetItem.call(localStorage, 'currentUserKey') ||
    rawStorageGetItem.call(localStorage, 'userMobile') ||
    rawStorageGetItem.call(localStorage, 'userEmail') ||
    '__guest__'
  );
}

function scopedStorageKey(key) {
  if (!USER_SCOPED_STORAGE_KEYS.has(String(key))) return key;
  return `mrMilk:${encodeURIComponent(getCurrentUserStorageKey())}:${key}`;
}

Storage.prototype.getItem = function(key) {
  return rawStorageGetItem.call(this, scopedStorageKey(key));
};

Storage.prototype.setItem = function(key, value) {
  return rawStorageSetItem.call(this, scopedStorageKey(key), value);
};

Storage.prototype.removeItem = function(key) {
  return rawStorageRemoveItem.call(this, scopedStorageKey(key));
};

function undoSavedPauseForJune26() {
  const undoKey = `mrMilk:${encodeURIComponent(getCurrentUserStorageKey())}:undoPause20260626`;
  if (rawStorageGetItem.call(localStorage, undoKey) === "done") return false;

  const targetDate = "2026-06-26";
  const removePause = controls => (Array.isArray(controls) ? controls : [])
    .filter(control =>
      !(control?.type === "pause" && String(control.effectiveDate) === targetDate)
    );

  const orders = JSON.parse(localStorage.getItem("placedOrders")) || [];
  const cleanedOrders = orders.map(order => ({
    ...order,
    items: (order.items || []).map(item => {
      const controls = removePause(item.deliveryControls);
      return {
        ...item,
        deliveryControls: controls,
        deliveryControlsSummary: getDeliveryControlsSummaryText(controls)
      };
    })
  }));
  localStorage.setItem("placedOrders", JSON.stringify(cleanedOrders));

  const savedProducts =
    JSON.parse(localStorage.getItem("deliveryControlsByProduct")) || {};
  Object.values(savedProducts).forEach(saved => {
    if (!saved) return;
    const controls = removePause(saved?.controls);
    saved.controls = controls;
    saved.adminSummary = getDeliveryControlsSummaryText(controls);
    if (saved.product) {
      saved.product.deliveryControls = controls;
      saved.product.deliveryControlsSummary = saved.adminSummary;
    }
  });
  localStorage.setItem(
    "deliveryControlsByProduct",
    JSON.stringify(savedProducts)
  );

  const transactions =
    JSON.parse(localStorage.getItem("milkCashTransactions")) || [];
  localStorage.setItem(
    "milkCashTransactions",
    JSON.stringify(transactions.filter(transaction =>
      !(
        transaction?.title === "Subscription Credit" &&
        String(transaction.effectiveDate) === targetDate
      )
    ))
  );

  rawStorageSetItem.call(localStorage, undoKey, "done");
  return true;
}

const didUndoJune26Pause = undoSavedPauseForJune26();

/* ================= GLOBAL DOM REFERENCES AND APP STATE =================
   Ye variables poore app me shared hain.
   screens/navTriggers buttons ko JS navigation ke liye use kiya jata hai.
   payment/cart/timer state yaha rakhi hai taki different functions same state read kar sakein.
*/
    const screens = document.querySelectorAll('.screen');
    let currentProduct = "";
    let currentProductName = "";
    let isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    let basePrice = 0;
    const navTriggers = document.querySelectorAll('[data-go-screen]');
    let previousScreen = "home";
    let lastWishlistScreen = "";
    const bottomNavItems = document.querySelectorAll('.bottom-nav .nav-item');
    const filterButtons = document.querySelectorAll('[data-filter]');
    const productSections = document.querySelectorAll('[data-section]');
    const planCards = document.querySelectorAll('.plan-card');
    const radioPills = document.querySelectorAll('.radio-pill');
    const dayPills = document.querySelectorAll('.day-pill');
    const quantityDisplay = document.getElementById('quantity-value');
    const plusBtn = document.querySelector('.plus-btn');
    const minusBtn = document.querySelector('.minus-btn');
    let quantity = Number(quantityDisplay?.textContent || 1);
    let selectedPaymentMethod = "cod";
    let upiScanSelected = false;
    let screenHistory = [];
    let upiQrTimer = null;
    let upiQrSecondsLeft = 80;
    let paymentSuccessTimer = null;
    let activeRazorpayAttempt = null;
    let razorpayPaymentPollTimer = null;
    let razorpayPaymentPollInFlight = false;
    let upiAutoRedirectTimer = null;
    const MR_MILK_UPI_CONFIG = {
      payeeVpa: "7230920774@ptyes",
      payeeName: "M R MILK",
      transactionNote: "M.R Milk order payment"
    };
    let pendingOrderCancel = null;
    let isBrowserHistoryNavigation = false;
    let appHistoryReady = false;
    let skipNextScreenHistoryPop = false;
    const productCatalog = new Map();

const LOCAL_IMAGE_PATHS = Object.freeze({
  'A2 ghee.png': 'images/A2 ghee.png',
  'a2 milk (2).png': 'images/A2 MILK.png',
  'A2 MILK.png': 'images/A2 MILK.png',
  'Banner 1.png': 'images/Banner 1.png',
  'Banner 2.png': 'images/Banner 2.png',
  'Banner 3.png': 'images/Banner 3.png',
  'BUFFALO CHAACH .png': 'images/BUFFALO CHAACH.png',
  'BUFFALO CHAACH.png': 'images/BUFFALO CHAACH.png',
  'buffalo ghee.png': 'images/buffalo ghee.png',
  'BUFFALO MILK .png': 'images/BUFFALO MILK (2).png',
  'BUFFALO MILK.png': 'images/BUFFALO MILK (2).png',
  'BUFFALO MILK (2).png': 'images/BUFFALO MILK (2).png',
  'buffalo milk.png': 'images/BUFFALO MILK (2).png',
  'C chaach .png': 'images/COW CHAACH.png',
  'category_chaach.png': 'images/category_chaach.png',
  'category_ghee.png': 'images/category_ghee.png',
  'category_milk.png': 'images/category_milk.png',
  'Chaach.png': 'images/BUFFALO CHAACH.png',
  'COW CHAACH .png': 'images/COW CHAACH.png',
  'COW CHAACH.png': 'images/COW CHAACH.png',
  'COW GHEE .png': 'images/COWW GHEEE.png',
  'COWW GHEEE.png': 'images/COWW GHEEE.png',
  'cow ghee.png': 'images/COWW GHEEE.png',
  'COW MILK.png': 'images/COW MILK.png',
  'DAHI (1).png': 'images/DAHI (1).png',
  'Dahi.png': 'images/DAHI (1).png',
  'DESIGN END.png': 'images/DESIGN END.png',
  'Ghee.png': 'images/A2 ghee.png',
  'login-logo.png': 'images/login-logo.png',
  'Milk.png': 'images/COW MILK.png',
  'mr-milk-logo-cropped.png': 'images/mr-milk-logo-cropped.png',
  'paneer (1).png': 'images/paneer (1).png',
  'Paneer.png': 'images/paneer (1).png',
  'See you soon.png': 'images/See you soon.png',
  'upi-payment-qr.png': 'images/upi-payment-qr.png'
});

function getInlineImageSrc(fileName) {
  return LOCAL_IMAGE_PATHS[String(fileName || '').trim()] || '';
}

function getProductImagePath(productName, fallback = "") {
  const name = normalizeProductName(productName);
  const productImages = {
    "RAW BUFFALO MILK": "images/Milk.png",
    "RAW COW MILK": "images/Milk.png",
    "RAW A2 COW MILK": "images/Milk.png",
    "BUFFALO BILONA CHAACH": "images/Chaach.png",
    "COW BILONA CHAACH": "images/Chaach.png",
    "BUFFALO GHEE": "images/Ghee.png",
    "COW GHEE": "images/Ghee.png",
    "RAW A2 COW GHEE": "images/Ghee.png",
    "DAHI": "images/Dahi.png",
    "PANEER": "images/Paneer.png"
    
  };

  return productImages[name] || normalizeAssetPath(fallback);
}

function setDetailProductImage(productName, fallback = "") {
  const detailImage = document.getElementById('detail-image');
  if (!detailImage) return "";

  const image = getProductImagePath(productName, fallback);
  detailImage.style.display = '';
  detailImage.src = image;
  return image;
}

function getCartProductImagePath(item) {
  return getProductImagePath(item?.name, item?.image || item?.image_url || "");
}



/* ================= SMALL NAVIGATION HELPERS =================
   Active screen ka naam nikalna aur home header ka scroll behavior yaha hai.
*/
function getActiveScreenName() {
  return document.querySelector('.screen.active')?.dataset.screen || null;
}

const appShell = document.querySelector('.mobile-app');
let appHeaderScrollTimer = null;

function setupAppSplash() {
  const splash = document.getElementById('appSplash');
  if (!splash) return;

  const hideSplash = () => {
    splash.classList.add('is-hidden');
  };

  splash.addEventListener('animationend', event => {
    if (event.animationName === 'splashOverlayExit') hideSplash();
  });

  window.setTimeout(hideSplash, 1150);
}

function setupAppHeaderAutoReveal() {
  window.addEventListener('scroll', () => {
    if (getActiveScreenName() !== 'home') {
      appShell?.classList.remove('appbar-scrolling');
      return;
    }

    appShell.classList.add('appbar-scrolling');
    window.clearTimeout(appHeaderScrollTimer);

    appHeaderScrollTimer = window.setTimeout(() => {
      appShell.classList.remove('appbar-scrolling');
    }, 180);
  }, { passive: true });
}

setupAppSplash();

/* ================= PRODUCT CATALOG FROM SUPABASE =================
   Supabase product_catalog table se prices, images, descriptions aur stock status aate hain.
   Local HTML product cards ko DB values se overwrite karne ke liye ye helpers use hote hain.
*/
function normalizeProductName(name) {
  return String(name || "").trim().toUpperCase();
}

function getProductCatalog(name) {
  return productCatalog.get(normalizeProductName(name)) || null;
}

function getCatalogPlanPrice(productName, planName) {
  const catalog = getProductCatalog(productName);
  if (!catalog) return null;

  const plan = String(planName || "").trim();
  if (plan === "Monthly" && catalog.monthlyPrice !== null) return catalog.monthlyPrice;
  if (plan === "15 Days" && catalog.fifteenDayPrice !== null) return catalog.fifteenDayPrice;
  if (plan === "Weekly" && catalog.weeklyPrice !== null) return catalog.weeklyPrice;
  if (plan === "One Time Only" && catalog.oneTimePrice !== null) return catalog.oneTimePrice;
  if (plan === "Customised" && catalog.customPrice !== null) return catalog.customPrice;
  return catalog.defaultPrice;
}

function normalizeAssetPath(path) {
  const rawPath = String(path || "").trim();
  if (!rawPath) return "";

  const imageMatch = rawPath.match(/(?:^|\/)(?:frontend\/)?(?:assets\/)?images\/([^?#]+)([?#].*)?$/i);
  if (imageMatch) {
    const localImageName = decodeURIComponent(imageMatch[1]);
    return getInlineImageSrc(localImageName) || rawPath;
  }

  return rawPath;
}

function normalizeCatalogRow(row) {
  return {
    name: row.product_name,
    category: row.category,
    description: row.description || "",
    imageUrl: normalizeAssetPath(row.image_url),
    displayPriceText: row.display_price_text || "",
    unitLabel: row.unit_label || "L",
    defaultPrice: Number(row.default_price || 0),
    monthlyPrice: row.monthly_price === null ? null : Number(row.monthly_price),
    fifteenDayPrice: row.fifteen_day_price === null ? null : Number(row.fifteen_day_price),
    weeklyPrice: row.weekly_price === null ? null : Number(row.weekly_price),
    oneTimePrice: row.one_time_price === null ? null : Number(row.one_time_price),
    customPrice: row.custom_price === null ? null : Number(row.custom_price),
    isAvailable: row.is_available !== false,
    availabilityMessage: row.availability_message || "Available"
  };
}

function applyProductCatalogToCards() {
  document.querySelectorAll('#products-screen .product-card').forEach(card => {
    const name = card.querySelector('h3')?.textContent.trim();
    const catalog = getProductCatalog(name);
    if (!catalog) return;

    if (catalog.description) {
      const descriptionEl = card.querySelector('.product-body p');
      if (descriptionEl) descriptionEl.textContent = catalog.description;
    }

    if (catalog.displayPriceText) {
      const priceEl = card.querySelector('strong');
      if (priceEl) priceEl.textContent = catalog.displayPriceText;
    }

    if (catalog.imageUrl) {
      const imageEl = card.querySelector('img');
      if (imageEl) imageEl.src = catalog.imageUrl;
    }

    const buyBtn = card.querySelector('.buy-btn');
    card.classList.toggle('out-of-stock', !catalog.isAvailable);
    if (buyBtn) {
      buyBtn.disabled = !catalog.isAvailable;
      buyBtn.textContent = catalog.isAvailable ? "SUBSCRIBE" : "OUT OF STOCK";
    }

    let stockBadge = card.querySelector('.stock-status-badge');
    if (!catalog.isAvailable) {
      if (!stockBadge) {
        stockBadge = document.createElement('span');
        stockBadge.className = 'stock-status-badge';
        card.querySelector('.product-visual')?.appendChild(stockBadge);
      }
      stockBadge.textContent = catalog.availabilityMessage || "Out of stock";
    } else {
      stockBadge?.remove();
    }
  });
}

async function hydrateProductCatalogFromDatabase() {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data, error } = await sb
    .from('product_catalog')
    .select('product_name,category,description,image_url,display_price_text,unit_label,default_price,monthly_price,fifteen_day_price,weekly_price,one_time_price,custom_price,is_available,availability_message')
    .order('display_order', { ascending: true });

  if (error || !Array.isArray(data)) {
    console.log(error || 'Product catalog not available');
    return;
  }

  productCatalog.clear();
  data.forEach(row => {
    const catalog = normalizeCatalogRow(row);
    productCatalog.set(normalizeProductName(catalog.name), catalog);
  });

  applyProductCatalogToCards();
  markOneTimeProductCards();
  updateNotificationBadge();
}

/* ================= PAYMENT FLOW AND QR TIMER =================
   Payment screen, COD/UPI/card tab rendering, QR countdown, payment success,
   aur payment cancel confirmation logic yaha grouped hai.
*/
function navigateBack(fallback = "home") {
  const target = screenHistory.pop() || fallback;

  if (window.history?.state?.appScreen && target !== getActiveScreenName()) {
    isBrowserHistoryNavigation = true;
    skipNextScreenHistoryPop = true;
    window.history.back();
    window.setTimeout(() => {
      if (getActiveScreenName() !== target) {
        setActiveScreen(target, {
          fromBack: true,
          skipBrowserHistory: true
        });
      }
      isBrowserHistoryNavigation = false;
    }, 80);
    return;
  }

  setActiveScreen(target, {
    fromBack: true,
    replace: true
  });
}

function getScreenUrl(screenName) {
  const url = new URL(window.location.href);
  url.hash = screenName && screenName !== "home" ? `#${screenName}` : "";
  return url.pathname + url.search + url.hash;
}

function syncBrowserHistoryForScreen(screenName, { replace = false } = {}) {
  if (!window.history?.pushState) return;

  const state = { appScreen: screenName };
  const url = getScreenUrl(screenName);

  if (replace || !appHistoryReady) {
    window.history.replaceState(state, "", url);
    appHistoryReady = true;
    return;
  }

  window.history.pushState(state, "", url);
}

function initAppBrowserHistory() {
  const activeScreen = getActiveScreenName() || "home";
  syncBrowserHistoryForScreen(activeScreen, { replace: true });
}

window.addEventListener('popstate', event => {
  const target = event.state?.appScreen;

  if (!target) return;

  isBrowserHistoryNavigation = true;
  if (skipNextScreenHistoryPop) {
    skipNextScreenHistoryPop = false;
  } else {
    screenHistory.pop();
  }
  setActiveScreen(target, {
    fromBack: true,
    skipBrowserHistory: true
  });
  isBrowserHistoryNavigation = false;
});

function isPaymentExitScreen(screenName) {
  return screenName === 'paymentMode' || screenName === 'upiQr';
}

function showPaymentCancelModal() {
  document.getElementById('paymentCancelModal')?.classList.add('active');
}

function hidePaymentCancelModal() {
  document.getElementById('paymentCancelModal')?.classList.remove('active');
}

loadPaymentMode = function() {
  const total = getPaymentBaseTotal();
  const milkCashBalance = getMilkCashBalance();
  const saved = Math.min(milkCashBalance, total);

  const balanceEl = document.getElementById('milkcash-balance');
  const savedEl = document.getElementById('milkcash-saved-amount');

  if (balanceEl) balanceEl.textContent = formatPaymentCurrency(milkCashBalance);
  if (savedEl) savedEl.textContent = formatPaymentCurrency(saved);

  renderPaymentMode();
};

document.addEventListener('click', (event) => {
  const backTrigger = event.target.closest(
    '[data-screen-back], .back-btn, .address-back-btn, .delivery-back-btn, .topbar .icon-btn[data-go-screen], .upi-qr-head button[data-go-screen]'
  );

  if (!backTrigger) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (isPaymentExitScreen(getActiveScreenName())) {
    showPaymentCancelModal();
    return;
  }

  navigateBack(backTrigger.dataset.goScreen || "home");
}, true);

function loadUpiQrScreen() {
  const totalEl = document.getElementById('upiQrTotal');
  if (totalEl) totalEl.textContent = formatPaymentCurrency(getPaymentTotal());
  renderRazorpayQrState();
  startUpiQrTimer();
  startRazorpayPaymentPolling();
  scheduleUpiAutoRedirect();
}

function formatUpiQrTimer(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function updateUpiQrTimerDisplay() {
  const timerEl = document.getElementById('upiQrTimer');
  if (!timerEl) return;
  timerEl.textContent = `This qr will expire in ${formatUpiQrTimer(upiQrSecondsLeft)}`;
}

function stopUpiQrTimer() {
  if (upiQrTimer) {
    clearInterval(upiQrTimer);
    upiQrTimer = null;
  }
  if (upiAutoRedirectTimer) {
    clearTimeout(upiAutoRedirectTimer);
    upiAutoRedirectTimer = null;
  }
  stopRazorpayPaymentPolling();
}

function startUpiQrTimer() {
  stopUpiQrTimer();
  upiQrSecondsLeft = getActiveQrSecondsLeft();
  updateUpiQrTimerDisplay();

  upiQrTimer = setInterval(() => {
    upiQrSecondsLeft -= 1;
    updateUpiQrTimerDisplay();

    if (upiQrSecondsLeft <= 0) {
      stopUpiQrTimer();
      updateRazorpayQrMessage("Payment expired", "Please go back and create a fresh QR.");
      setActiveScreen('orders', { replace: true });
    }
  }, 1000);
}

function getActiveQrSecondsLeft() {
  const expiresAt = activeRazorpayAttempt?.expiresAt;
  if (!expiresAt) return 80;

  const secondsLeft = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000);
  return Math.max(0, Math.min(secondsLeft, 180));
}

function normalizeRazorpayPaymentActionUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(upi|tez|phonepe|paytmmp|gpay):\/\//i.test(url)) return url;
  if (/^https?:\/\//i.test(url) && !/\/qr_codes\/|\/payments\/qr|api\.razorpay\.com/i.test(url)) return url;
  return "";
}

function getConfiguredMerchantUpiUrl(amount = getPaymentTotal()) {
  const configuredVpa = localStorage.getItem("mrMilkMerchantUpiId") || MR_MILK_UPI_CONFIG.payeeVpa || "";
  const payeeVpa = String(configuredVpa).trim().replace(/\s/g, "");
  if (!/^[^\s@]+@[^\s@]+$/.test(payeeVpa)) return "";

  const params = new URLSearchParams({
    pa: payeeVpa,
    pn: MR_MILK_UPI_CONFIG.payeeName || "M R MILK",
    am: Number(amount || 0).toFixed(2),
    cu: "INR",
    tn: MR_MILK_UPI_CONFIG.transactionNote || "M.R Milk order payment"
  });

  return `upi://pay?${params.toString()}`;
}

function isLikelyMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

function getMobileUpiLaunchUrl(actionUrl) {
  const url = normalizeRazorpayPaymentActionUrl(actionUrl);
  if (!url) return "";
  if (/Android/i.test(navigator.userAgent || "") && /^upi:\/\/pay\?/i.test(url)) {
    return url.replace(/^upi:\/\//i, "intent://") + "#Intent;scheme=upi;end";
  }
  return url;
}

function redirectToUpiPaymentApp(actionUrl) {
  const upiUrl = normalizeRazorpayPaymentActionUrl(actionUrl);
  if (!upiUrl) return false;

  const openUrl = url => {
    const link = document.createElement("a");
    link.href = url;
    link.rel = "noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => link.remove(), 1000);
  };

  openUrl(upiUrl);

  const intentUrl = getMobileUpiLaunchUrl(upiUrl);
  if (intentUrl && intentUrl !== upiUrl) {
    setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.location.href = intentUrl;
      }
    }, 650);
  }
  return true;
}

function scheduleUpiAutoRedirect() {
  if (upiAutoRedirectTimer) {
    clearTimeout(upiAutoRedirectTimer);
    upiAutoRedirectTimer = null;
  }

  if (!activeRazorpayAttempt?.actionUrl || activeRazorpayAttempt.autoRedirected) return;
  if (!isLikelyMobileDevice()) {
    updateRazorpayQrMessage("Scan to pay", "Open this checkout on your phone for automatic UPI redirect, or scan this QR from any UPI app.");
    return;
  }

  activeRazorpayAttempt.autoRedirected = true;
  updateRazorpayQrMessage("Redirecting to UPI app", "Complete the payment in your UPI app, then return here for confirmation.");
  upiAutoRedirectTimer = setTimeout(() => {
    openRazorpayUpiAction("UPI app", "any");
  }, 450);
}

function getUpiActionUrlForApp(actionUrl, app = "any") {
  const url = normalizeRazorpayPaymentActionUrl(actionUrl);
  if (!url) return "";
  if (app === "any" || /^https?:\/\//i.test(url)) return url;

  const upiMatch = url.match(/^upi:\/\/pay(\?.*)$/i);
  if (!upiMatch) return url;

  const query = upiMatch[1];
  const appSchemes = {
    gpay: `tez://upi/pay${query}`,
    phonepe: `phonepe://pay${query}`,
    paytm: `paytmmp://pay${query}`
  };

  return appSchemes[app] || url;
}

function findRazorpayPaymentActionUrl(data) {
  const directFields = [
    "upiLink",
    "upi_link",
    "upiIntent",
    "upi_intent",
    "upiIntentUrl",
    "upi_intent_url",
    "upiUrl",
    "upi_url",
    "intentUrl",
    "intent_url",
    "qrString",
    "qr_string",
    "qrIntent",
    "qr_intent",
    "deepLink",
    "deep_link",
    "paymentLink",
    "payment_link",
    "paymentUrl",
    "payment_url",
    "shortUrl",
    "short_url"
  ];
  const seen = new Set();
  const queue = [data, data?.qr, data?.qrCode, data?.qr_code, data?.paymentLink, data?.payment_link];

  while (queue.length) {
    const container = queue.shift();
    if (!container || typeof container !== "object") continue;
    if (seen.has(container)) continue;
    seen.add(container);

    for (const field of directFields) {
      const url = normalizeRazorpayPaymentActionUrl(container[field]);
      if (url) return url;
    }

    for (const value of Object.values(container)) {
      const url = normalizeRazorpayPaymentActionUrl(value);
      if (url) return url;
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return "";
}

function renderUpiQrActions() {
  const actionsEl = document.getElementById('upiQrActions');
  const helpEl = document.getElementById('upiQrNextHelp');
  const redirectTextEl = document.getElementById('upiQrRedirectText');
  const actionUrl = activeRazorpayAttempt?.actionUrl || "";
  const hasActionUrl = Boolean(actionUrl);

  if (actionsEl) actionsEl.hidden = !hasActionUrl;
  if (redirectTextEl) {
    redirectTextEl.textContent = isLikelyMobileDevice()
      ? "Opening your UPI app automatically..."
      : "Automatic UPI redirect is ready on phone.";
  }
  if (helpEl) {
    helpEl.textContent = hasActionUrl
      ? "UPI app me payment complete karein, phir yaha wapas aa jaayein. Hum payment verify kar denge."
      : "Automatic redirect ke liye Razorpay response me UPI intent/payment link chahiye. Abhi QR ko dusre device se scan karein.";
  }
}

function renderRazorpayQrState() {
  const qrImage = document.getElementById('upiQrImage');
  const qrTitle = document.querySelector('#upi-qr-screen .upi-qr-card h3');
  const isDirectMobileUpi = Boolean(activeRazorpayAttempt?.isDirectUpi && isLikelyMobileDevice());
  if (qrImage && activeRazorpayAttempt?.imageUrl) {
    qrImage.src = activeRazorpayAttempt.imageUrl;
    qrImage.hidden = isDirectMobileUpi;
  }
  if (qrTitle) {
    qrTitle.textContent = isDirectMobileUpi ? "Opening UPI app" : "Scan via any UPI app";
  }

  renderUpiQrActions();

  updateRazorpayQrMessage(
    activeRazorpayAttempt ? "Payment in progress" : "Preparing payment",
    activeRazorpayAttempt
      ? "Do not refresh or redirect while we verify your payment."
      : "Please wait while we create your secure QR."
  );
}

function updateRazorpayQrMessage(title, message) {
  const progressEl = document.getElementById('upiQrProgress');
  const warningEl = document.getElementById('upiQrWarning');

  if (progressEl) progressEl.textContent = title;
  if (warningEl) warningEl.textContent = message;
}

function startDirectUpiPayment(actionUrl, amount) {
  if (!actionUrl) return false;

  activeRazorpayAttempt = {
    attemptId: `upi-${Date.now()}`,
    imageUrl: normalizeAssetPath("images/upi-payment-qr.png"),
    actionUrl,
    expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    amount,
    isDirectUpi: true
  };
  setActiveScreen('upiQr');
  return true;
}

function stopRazorpayPaymentPolling() {
  if (razorpayPaymentPollTimer) {
    clearInterval(razorpayPaymentPollTimer);
    razorpayPaymentPollTimer = null;
  }
  razorpayPaymentPollInFlight = false;
}

async function startRazorpayQrPayment() {
  const sb = window.supabaseClient;
  const amount = getPaymentTotal();
  if (!amount || amount <= 0) {
    showToast("Payment amount is not valid");
    return false;
  }

  const configuredUpiUrl = getConfiguredMerchantUpiUrl(amount);
  if (startDirectUpiPayment(configuredUpiUrl, amount)) {
    if (isLikelyMobileDevice()) {
      activeRazorpayAttempt.autoRedirected = true;
      updateRazorpayQrMessage("Redirecting to UPI app", "Complete the payment in your UPI app, then return here.");
      redirectToUpiPaymentApp(configuredUpiUrl);
    }
    return true;
  }

  if (!sb?.functions?.invoke) {
    showToast("Online payment setup pending. Please choose COD for now.");
    return false;
  }

  try {
    updateRazorpayQrMessage("Preparing payment", "Please wait while we create your secure QR.");

    const { data, error } = await sb.functions.invoke("razorpay-create-qr", {
      body: {
        amount,
        currency: "INR",
        description: "M.R Milk order payment",
        customer: {
          name: localStorage.getItem("userName") || localStorage.getItem("profileName") || "",
          email: localStorage.getItem("userEmail") || "",
          mobile: localStorage.getItem("userMobile") || ""
        }
      }
    });

    if (error || !data?.attemptId || !data?.imageUrl) {
      console.log("Razorpay QR create failed", error || data);
      if (startDirectUpiPayment(configuredUpiUrl, amount)) return true;
      showToast("Online payment setup pending. Please choose COD for now.");
      return false;
    }

    activeRazorpayAttempt = {
      attemptId: data.attemptId,
      qrId: data.qrId,
      imageUrl: data.imageUrl,
      actionUrl: configuredUpiUrl || findRazorpayPaymentActionUrl(data),
      expiresAt: data.expiresAt,
      amount: Number(data.amount) || amount
    };

    setActiveScreen('upiQr');
    return true;
  } catch (error) {
    console.log("Razorpay QR create failed", error);
    if (startDirectUpiPayment(configuredUpiUrl, amount)) return true;
    showToast("Online payment setup pending. Please choose COD for now.");
    return false;
  }
}

function startRazorpayPaymentPolling() {
  stopRazorpayPaymentPolling();
  if (!activeRazorpayAttempt?.attemptId || activeRazorpayAttempt?.isDirectUpi) return;

  checkRazorpayPaymentStatus();
  razorpayPaymentPollTimer = setInterval(checkRazorpayPaymentStatus, 3000);
}

async function checkRazorpayPaymentStatus() {
  if (razorpayPaymentPollInFlight || !activeRazorpayAttempt?.attemptId) return;
  if (activeRazorpayAttempt?.isDirectUpi) {
    updateRazorpayQrMessage("Payment submitted", "UPI app me payment success hone ke baad transaction ID save rakhein.");
    showToast("Payment proof/transaction ID save rakhein.");
    return;
  }

  const sb = window.supabaseClient;
  if (!sb?.functions?.invoke) return;

  razorpayPaymentPollInFlight = true;

  try {
    const { data, error } = await sb.functions.invoke("razorpay-payment-status", {
      body: { attemptId: activeRazorpayAttempt.attemptId }
    });

    if (error || !data) {
      console.log("Razorpay status check failed", error || data);
      return;
    }

    if (data.status === "captured" || data.status === "paid") {
      stopRazorpayPaymentPolling();
      updateRazorpayQrMessage("Payment received", "Confirming your order now.");
      saveSelectedCartAsSubscribedProducts();
      completeSelectedCartOrder("UPI (Razorpay)");
      renderDailyDeliveryCard();
      activeRazorpayAttempt = null;
      showPaymentSuccessScreen();
      return;
    }

    if (data.status === "failed") {
      stopRazorpayPaymentPolling();
      updateRazorpayQrMessage("Payment failed", "Please go back and try again.");
      showToast("Payment failed. Please try again.");
      return;
    }

    if (data.status === "expired" || data.status === "closed") {
      stopRazorpayPaymentPolling();
      updateRazorpayQrMessage("Payment expired", "Please go back and create a fresh QR.");
    }
  } catch (error) {
    console.log("Razorpay status check failed", error);
  } finally {
    razorpayPaymentPollInFlight = false;
  }
}

function openRazorpayUpiAction(appName = "UPI app", app = "any") {
  const actionUrl = getConfiguredMerchantUpiUrl(activeRazorpayAttempt?.amount) || activeRazorpayAttempt?.actionUrl || "";
  if (!actionUrl) {
    showToast("Same phone payment link is not available. Please scan the QR from another device.");
    return;
  }

  updateRazorpayQrMessage("Waiting for payment", `Complete the payment in ${appName}, then return here.`);
  redirectToUpiPaymentApp(getUpiActionUrlForApp(actionUrl, app));
}

function showPaymentSuccessScreen() {
  clearTimeout(paymentSuccessTimer);
  const successLogo = document.querySelector('#success-screen .login-top-image');
  if (successLogo) {
    successLogo.src = "images/mr-milk-logo-cropped.png";
    successLogo.classList.add("payment-success-logo");
  }
  document.querySelector('#success-screen .success-sub').textContent = "Payment";
  document.querySelector('#success-screen .success-main').textContent = "Successful!!";
  setActiveScreen('success', { replace: true });

  paymentSuccessTimer = setTimeout(() => {
    renderDailyDeliveryCard();
    setActiveScreen('home', { replace: true });
  }, 2000);
}

function formatPaymentCurrency(amount) {
  const value = Number(amount) || 0;
  const hasPaise = !Number.isInteger(value);

  return `\u20B9${value.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2
  })}`;
}

const COD_ONE_TIME_ONLY_NOTE = "Only available for One Time Only Plan";

function getPaymentCheckoutItems() {
  const cart = JSON.parse(localStorage.getItem('cart')) || [];
  loadSelectedCartItems();
  return getCheckoutItems(cart);
}

function isOneTimePaymentItem(item) {
  const plan = String(item?.plan || "").trim().toLowerCase();
  const name = String(item?.name || "").trim().toLowerCase();
  const startDate = parseDeliveryDate(item?.start);
  const endDate = parseDeliveryDate(item?.end);
  const isSingleDayCustomised =
    plan === "customised" &&
    startDate &&
    endDate &&
    isSameDeliveryDay(startDate, endDate);

  return (
    plan === "one time only" ||
    isSingleDayCustomised ||
    name.includes("ghee") ||
    name === "paneer"
  );
}

function isCodAvailableForCheckout(items = getPaymentCheckoutItems()) {
  return items.length > 0 && items.every(isOneTimePaymentItem);
}

function ensureValidPaymentMethod() {
  if (selectedPaymentMethod === "cod" && !isCodAvailableForCheckout()) {
    selectedPaymentMethod = "upi";
    upiScanSelected = false;
  }
}

function getPaymentBaseTotal() {
  return calculateOrderTotal(getPaymentCheckoutItems());
}

function isMilkCashSelected() {
  return Boolean(document.getElementById('milkcash-checkbox')?.checked);
}

function getMilkCashDiscount() {
  if (!isMilkCashSelected()) return 0;
  return Math.min(getMilkCashBalance(), getPaymentBaseTotal());
}

function getPaymentTotal() {
  const codFee = selectedPaymentMethod === "cod" && isCodAvailableForCheckout() ? 10 : 0;
  return Math.max(0, getPaymentBaseTotal() - getMilkCashDiscount()) + codFee;
}

function renderPaymentMode() {
  ensureValidPaymentMethod();
  const codAvailable = isCodAvailableForCheckout();

  document.querySelectorAll('.payment-method-tab').forEach(tab => {
    const isCodTab = tab.dataset.paymentMethod === "cod";

    if (isCodTab) {
      const note = tab.querySelector('.payment-method-note');

      tab.disabled = !codAvailable;
      tab.setAttribute("aria-disabled", String(!codAvailable));
      tab.classList.toggle('payment-method-tab-unavailable', !codAvailable);

      if (!codAvailable && !note) {
        tab.insertAdjacentHTML("beforeend", `<small class="payment-method-note">${COD_ONE_TIME_ONLY_NOTE}</small>`);
      } else if (codAvailable && note) {
        note.remove();
      }
    }

    tab.classList.toggle('active', tab.dataset.paymentMethod === selectedPaymentMethod);
  });

  renderPaymentSummary();
  renderPaymentMethodContent();
}

function renderPaymentSummary() {
  const summary = document.getElementById('paymentCartSummary');
  if (!summary) return;

  const checkoutItems = getPaymentCheckoutItems();
  const baseTotal = getPaymentBaseTotal();
  const codFee = selectedPaymentMethod === "cod" && isCodAvailableForCheckout() ? 10 : 0;
  const milkCashDiscount = getMilkCashDiscount();
  const total = Math.max(0, baseTotal - milkCashDiscount) + codFee;

  summary.innerHTML = `
    <div class="payment-summary-box">
      <h3>PRICE DETAILS</h3>
      ${renderPlanPriceBreakdown(checkoutItems)}
      <div class="payment-summary-line">
        <span>Bag Total</span>
        <strong>${formatPaymentCurrency(baseTotal)}</strong>
      </div>
      <div class="payment-summary-line">
        <span>Mr.MilkCash Discount</span>
        <strong>-${formatPaymentCurrency(milkCashDiscount)}</strong>
      </div>
      ${codFee ? `
        <div class="payment-summary-line">
          <span>Cash on Delivery Fee</span>
          <strong>${formatPaymentCurrency(codFee)}</strong>
        </div>
      ` : ""}
      <div class="payment-summary-total">
        <span>Total Amount</span>
        <strong>${formatPaymentCurrency(total)}</strong>
      </div>
      <p>By placing the order, you agree to Mr.Milk's Terms of Use and Privacy Policy</p>
    </div>
  `;
}

function renderPaymentMethodContent() {
  const content = document.getElementById('paymentMethodContent');
  if (!content) return;

  ensureValidPaymentMethod();
  const total = getPaymentTotal();

  if (selectedPaymentMethod === "cod") {
    content.innerHTML = `
      <h3>Cash On Delivery (Cash/UPI)</h3>
      <label class="payment-radio-row">
        <input type="radio" name="codOption" checked>
        <span>Cash on Delivery (Cash/UPI)</span>
      </label>
      <p class="payment-help">For this option, there is a fee of ${formatPaymentCurrency(10)}. You can Pay online to avoid this.</p>
      <button type="button" class="payment-primary-btn" data-cod-pay>Pay ${formatPaymentCurrency(total)}</button>
    `;
    return;
  }

  if (selectedPaymentMethod === "upi") {
    content.innerHTML = `
      <h3>Pay using UPI</h3>
      <label class="payment-radio-row scan-pay-row">
        <input type="radio" name="upiOption" id="scanPayRadio" ${upiScanSelected ? "checked" : ""}>
        <span class="mini-qr-icon" aria-hidden="true">
          <img src="images/upi-payment-qr.png" alt="">
        </span>
        <span>Scan & Pay</span>
      </label>
      <div class="scan-pay-box ${upiScanSelected ? "active" : ""}">
        <button type="button" class="payment-primary-btn" data-upi-pay>Pay Now</button>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <h3>Credit/Debit Card</h3>
    <p class="payment-help coming-soon-inline">This feature is coming soon</p>
  `;
}

function detectCardBrand(digits) {
  if (/^4/.test(digits)) return "VISA";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "MASTER";
  if (/^(60|65|81|82|508|353|356)/.test(digits)) return "RUPAY";
  return "CARD";
}

function isValidLuhn(digits) {
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function validatePaymentCardForm() {
  const numberInput = document.getElementById('paymentCardNumber');
  const expiryInput = document.getElementById('paymentCardExpiry');
  const cvvInput = document.getElementById('paymentCardCvv');
  const checkbox = document.getElementById('secureCardCheckbox');
  const payBtn = document.getElementById('cardPayNowBtn');
  const brandEl = document.getElementById('paymentCardBrand');
  const errorEl = document.getElementById('paymentCardError');

  if (!numberInput || !expiryInput || !cvvInput || !checkbox || !payBtn) return;

  const digits = numberInput.value.replace(/\D/g, "");
  const brand = detectCardBrand(digits);
  const isValidNumber = digits.length >= 13 && isValidLuhn(digits);
  const expiryValid = /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiryInput.value);
  const cvvValid = /^\d{3,4}$/.test(cvvInput.value);

  if (brandEl) brandEl.textContent = brand;
  if (errorEl) {
    errorEl.textContent =
      digits.length >= 13 && !isValidNumber
        ? "Invalid Card. Please enter a valid card number"
        : "";
  }

  payBtn.disabled = !(isValidNumber && expiryValid && cvvValid && checkbox.checked);
}

document.addEventListener('click', (event) => {
  const pauseDateBtn = event.target.closest('[data-dc-pause-date]');
  if (pauseDateBtn) {
    event.preventDefault();
    togglePauseDateSelection(pauseDateBtn.dataset.dcPauseDate);
    return;
  }

  const switchDateBtn = event.target.closest('[data-dc-switch-date]');
  if (switchDateBtn) {
    event.preventDefault();
    toggleSwitchDateSelection(switchDateBtn.dataset.dcSwitchDate);
    return;
  }

  const quantityDateBtn = event.target.closest('[data-dc-quantity-date]');
  if (quantityDateBtn) {
    event.preventDefault();
    toggleQuantityDateSelection(quantityDateBtn.dataset.dcQuantityDate);
    return;
  }

  const slotDateBtn = event.target.closest('[data-dc-slot-date]');
  if (slotDateBtn) {
    event.preventDefault();
    toggleSlotDateSelection(slotDateBtn.dataset.dcSlotDate);
    return;
  }

  const addressDateBtn = event.target.closest('[data-dc-address-date]');
  if (addressDateBtn) {
    event.preventDefault();
    toggleAddressDateSelection(addressDateBtn.dataset.dcAddressDate);
    return;
  }

  if (event.target.closest('#dailyAddItemsBtn')) {
    event.preventDefault();
    showAllProductsFilter();
    return;
  }

  const dailyScrollBtn = event.target.closest('[data-daily-scroll]');
  if (dailyScrollBtn) {
    event.preventDefault();
    const list = document.getElementById('dailyProductList');
    if (!list) return;

    const direction = dailyScrollBtn.dataset.dailyScroll === "left" ? -1 : 1;
    list.scrollBy({
      left: direction * Math.max(96, Math.floor(list.clientWidth * 0.75)),
      behavior: "smooth"
    });
    return;
  }

  const dailyProductCard = event.target.closest('.daily-product-card');
  if (dailyProductCard) {
    event.preventDefault();
    const index = Number(dailyProductCard.dataset.dailyProductIndex);
    const product = getHomeDeliveryProducts().products[index];
    openDeliveryControls(product);
    return;
  }

  if (event.target.closest('#dcSaveChangesBtn')) {
    event.preventDefault();
    saveDeliveryControlChanges();
    return;
  }

  if (event.target.closest('#dcAddAddressBtn')) {
    event.preventDefault();
    document.getElementById('dcAddressForm')?.classList.add('active');
    return;
  }

  if (event.target.closest('#dcCancelAddressBtn')) {
    event.preventDefault();
    closeDcAddressForm();
    return;
  }

  if (event.target.closest('#dcSaveAddressBtn')) {
    event.preventDefault();
    saveDcAddress();
    return;
  }

  const removeNotification = event.target.closest('[data-remove-notification]');
  if (removeNotification) {
    event.preventDefault();
    event.stopPropagation();
    const dismissed = new Set(getDismissedNotifications());
    dismissed.add(removeNotification.dataset.removeNotification);
    setDismissedNotifications([...dismissed]);
    renderNotifications();
    return;
  }

  const notificationCard = event.target.closest('.notification-card');
  if (notificationCard) {
    event.preventDefault();
    openNotificationTarget(notificationCard);
    return;
  }

  const methodTab = event.target.closest('[data-payment-method]');
  if (methodTab) {
    const paymentMethod = methodTab.dataset.paymentMethod;

    if (paymentMethod === "cod" && !isCodAvailableForCheckout()) {
      event.preventDefault();
      showToast(COD_ONE_TIME_ONLY_NOTE);
      renderPaymentMode();
      return;
    }

    if (methodTab.disabled || paymentMethod === "card") {
      event.preventDefault();
      return;
    }

    selectedPaymentMethod = paymentMethod;
    upiScanSelected = false;
    renderPaymentMode();
    return;
  }

  if (event.target.closest('#scanPayRadio')) {
    upiScanSelected = true;
    renderPaymentMode();
    return;
  }

  if (event.target.closest('[data-upi-pay]')) {
    startRazorpayQrPayment();
    return;
  }

  if (event.target.closest('[data-upi-check]')) {
    event.preventDefault();
    updateRazorpayQrMessage("Checking payment", "Please wait while we verify your payment.");
    checkRazorpayPaymentStatus();
    return;
  }

  if (event.target.closest('[data-upi-retry]')) {
    event.preventDefault();
    openRazorpayUpiAction("UPI app", "any");
    return;
  }

  if (event.target.closest('.upi-pay-btn')) {
    if (saveUpiFromWalletPayment()) {
      showPaymentSuccessScreen();
    }
    return;
  }

  if (event.target.closest('[data-cod-pay]')) {
    if (!isCodAvailableForCheckout()) {
      showToast(COD_ONE_TIME_ONLY_NOTE);
      selectedPaymentMethod = "upi";
      upiScanSelected = false;
      renderPaymentMode();
      return;
    }

    saveSelectedCartAsSubscribedProducts();
    completeSelectedCartOrder("Cash On Delivery");
    renderDailyDeliveryCard();
    showPaymentSuccessScreen();
    return;
  }

  const cardPayBtn = event.target.closest('#cardPayNowBtn');
  if (cardPayBtn && !cardPayBtn.disabled) {
    saveCardFromCheckoutPayment();
    saveSelectedCartAsSubscribedProducts();
    completeSelectedCartOrder("Card");
    renderDailyDeliveryCard();
    showPaymentSuccessScreen();
    return;
  }

  if (event.target.closest('.card-pay-btn')) {
    if (saveCardFromWalletPayment()) {
      showPaymentSuccessScreen();
    }
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'paymentCardNumber') {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 19);
    event.target.value = digits.replace(/(.{4})/g, "$1 ").trim();
    validatePaymentCardForm();
  }

  if (event.target.id === 'paymentCardExpiry') {
    let digits = event.target.value.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) {
      digits = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    event.target.value = digits;
    validatePaymentCardForm();
  }

  if (event.target.id === 'paymentCardCvv') {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
    validatePaymentCardForm();
  }

  if (event.target.id === 'profileCardNumber') {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 19);
    event.target.value = digits.replace(/(.{4})/g, "$1 ").trim();
  }

  if (event.target.id === 'profileCardExpiry') {
    let digits = event.target.value.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) {
      digits = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    event.target.value = digits;
  }

  if (event.target.id === 'profileUpiId') {
    event.target.value = event.target.value.replace(/\s/g, "");
  }

  if (event.target.id === 'dcAddressName') {
    let value = event.target.value.replace(/[^a-zA-Z\s]/g, "");
    event.target.value = value.replace(/\b\w/g, char => char.toUpperCase());
  }

  if (event.target.id === 'dcAddressMobile') {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 10);
  }

  const addressFieldPrefix = MAP_VERIFY_PREFIXES.find(prefix =>
    [
      `${prefix}Name`,
      `${prefix}Mobile`,
      `${prefix}House`,
      `${prefix}Street`,
      `${prefix}Town`,
      `${prefix}Pincode`,
      `${prefix}City`,
      `${prefix}State`
    ].includes(event.target.id)
  );

  if (addressFieldPrefix) {
    clearAddressMapVerification(addressFieldPrefix);
    updateAddressMapNote(addressFieldPrefix);
  }

  if (event.target.closest('#delivery-controls-screen')) {
    updateDeliveryControlSummary();
  }
});

document.addEventListener('change', (event) => {
  const deliveryDateModeNames = new Set([
    'dcPauseMode',
    'dcSwitchMode',
    'dcQuantityMode',
    'dcSlotMode',
    'dcAddressMode'
  ]);

  if (
    deliveryDateModeNames.has(event.target.name) &&
    event.target.value === "date"
  ) {
    if (event.target.checked) {
      deliveryCalendarOpen[event.target.name] = true;
    } else {
      event.target.checked = true;
      deliveryCalendarOpen[event.target.name] =
        !deliveryCalendarOpen[event.target.name];
    }
  }

  const controlTypeByMode = {
    dcPauseMode: "pause",
    dcSwitchMode: "switch_product",
    dcQuantityMode: "quantity",
    dcSlotMode: "slot",
    dcAddressMode: "address"
  };
  if (
    controlTypeByMode[event.target.name] &&
    event.target.value === "tomorrow"
  ) {
    const type = controlTypeByMode[event.target.name];
    const tomorrow = getTomorrowControlDate();
    setDeliveryControlRemoved(type, tomorrow, !event.target.checked);
    if (type === "pause") {
      if (event.target.checked) {
        removedDeliveryPauseDates = removedDeliveryPauseDates
          .filter(date => date !== tomorrow);
      } else if (getActiveDeliveryControls(activeDeliveryProduct).some(control =>
        control.type === "pause" && control.effectiveDate === tomorrow
      )) {
        removedDeliveryPauseDates = [...new Set([
          ...removedDeliveryPauseDates,
          tomorrow
        ])];
      }
    }
    markDeliveryControlsDirty();
  }

  if (event.target.name === 'dcPauseMode') {
    if (event.target.value === "tomorrow" && event.target.checked) {
      removedDeliveryPauseDates = removedDeliveryPauseDates
        .filter(date => date !== getTomorrowControlDate());
    }
    renderAllDeliveryControlCalendars();
  }

  const overrideModeNames = new Set([
    'dcSwitchMode',
    'dcQuantityMode',
    'dcSlotMode',
    'dcAddressMode'
  ]);

  if (
    overrideModeNames.has(event.target.name) &&
    event.target.value === "tomorrow" &&
    event.target.checked
  ) {
    removePauseFromDate(getTomorrowControlDate());
  }

  if (event.target.name === 'dcSwitchMode') {
    renderAllDeliveryControlCalendars();
  }

  if (event.target.name === 'dcQuantityMode') {
    renderAllDeliveryControlCalendars();
  }

  if (event.target.name === 'dcSlotMode') {
    renderAllDeliveryControlCalendars();
  }

  if (event.target.name === 'dcAddressMode') {
    renderAllDeliveryControlCalendars();
  }

  if (event.target.closest('#delivery-controls-screen')) {
    if (
      event.target.matches('select') ||
      (
        event.target.type === "checkbox" &&
        event.target.value !== "date"
      )
    ) {
      markDeliveryControlsDirty();
    }
    updateDeliveryControlSummary();
  }

  if (event.target.id === 'milkcash-checkbox') {
    renderPaymentMode();
  }

  if (event.target.id === 'secureCardCheckbox') {
    validatePaymentCardForm();
  }
});

document.addEventListener('click', (event) => {
  const addAddressBtn = event.target.closest('#cartAddAddressBtn');
  const checkoutAddressToggle = event.target.closest('#addressToggle');

  if (!addAddressBtn && !checkoutAddressToggle) return;

  event.preventDefault();

  if (addAddressBtn) {
    const wrap = document.getElementById('cartAddressFormWrap');
    if (!wrap) return;

    if (wrap.classList.contains('active')) {
      wrap.classList.remove('active');
      clearCartAddressForm();
    } else {
      clearCartAddressForm();
      wrap.classList.add('active');
    }
    return;
  }

  const wrap = document.getElementById('addressFormWrap');
  if (!wrap) return;

  if (wrap.classList.contains('active')) {
    wrap.classList.remove('active');
    clearCheckoutAddressForm();
  } else {
    clearCheckoutAddressForm();
    wrap.classList.add('active');
  }
});

document.addEventListener('click', (event) => {
  const profileOption = event.target.closest('.profile-option');
  if (
    profileOption &&
    profileOption.textContent.includes('My Orders')
  ) {
    event.preventDefault();
    setActiveScreen('profileOrders');
    return;
  }

  if (
    profileOption &&
    profileOption.textContent.includes('My Subscriptions')
  ) {
    event.preventDefault();
    setActiveScreen('profileSubscriptions');
    return;
  }

  if (
    profileOption &&
    profileOption.textContent.includes('Saved Addresses')
  ) {
    event.preventDefault();
    setActiveScreen('profileAddresses');
    return;
  }

  if (
    profileOption &&
    profileOption.textContent.includes('Saved Cards')
  ) {
    event.preventDefault();
    return;
  }

  if (
    profileOption &&
    profileOption.textContent.includes('Saved UPI')
  ) {
    event.preventDefault();
    setActiveScreen('profileUpi');
    return;
  }

  if (
    profileOption &&
    profileOption.textContent.includes('Terms Of Use')
  ) {
    event.preventDefault();
    setActiveScreen('terms');
    return;
  }

  if (
    profileOption &&
    profileOption.textContent.includes('Help & Support')
  ) {
    event.preventDefault();
    setActiveScreen('helpSupport');
    return;
  }

  if (
    profileOption &&
    (profileOption.dataset.profileAction === 'privacy' ||
      profileOption.textContent.includes('Privacy Policy'))
  ) {
    event.preventDefault();
    setActiveScreen('privacy');
    return;
  }

  if (event.target.closest('#cancelAddressBtn')) {
    event.preventDefault();
    closeCheckoutAddressForm();
    return;
  }

  if (
    event.target.closest('#addressMapCloseBtn') ||
    event.target.closest('#addressMapCancelBtn')
  ) {
    event.preventDefault();
    closeInAppAddressPicker();
    return;
  }

  if (event.target.closest('#addressMapUseBtn')) {
    event.preventDefault();
    useSelectedMapLocation();
    return;
  }

  const addressMapModal = event.target.closest('#addressMapModal');
  if (addressMapModal && event.target.id === 'addressMapModal') {
    event.preventDefault();
    closeInAppAddressPicker();
    return;
  }

  const addressMapBtn = event.target.closest('[data-address-map-prefix]');
  if (addressMapBtn) {
    event.preventDefault();
    openAddressMap(addressMapBtn.dataset.addressMapPrefix);
    return;
  }

  const savedAddressMapBtn = event.target.closest('[data-open-address-map]');
  if (savedAddressMapBtn) {
    event.preventDefault();
    window.open(savedAddressMapBtn.dataset.openAddressMap, '_blank', 'noopener');
    return;
  }

  if (event.target.closest('#saveAddressBtn')) {
    event.preventDefault();
    saveCheckoutAddress();
    return;
  }

  if (event.target.closest('#cartCancelAddressBtn')) {
    event.preventDefault();
    closeCartAddressForm();
    return;
  }

  if (event.target.closest('#cartSaveAddressBtn')) {
    event.preventDefault();
    saveCartAddress();
    return;
  }

  if (event.target.closest('#profileAddAddressBtn')) {
    event.preventDefault();
    toggleProfileAddressForm();
    return;
  }

  if (event.target.closest('#profileCancelAddressBtn')) {
    event.preventDefault();
    closeProfileAddressForm();
    return;
  }

  if (event.target.closest('#profileSaveAddressBtn')) {
    event.preventDefault();
    saveProfileAddress();
    return;
  }

  if (event.target.closest('#profileAddCardBtn')) {
    event.preventDefault();
    toggleProfileCardForm();
    return;
  }

  if (event.target.closest('#profileCancelCardBtn')) {
    event.preventDefault();
    closeProfileCardForm();
    return;
  }

  if (event.target.closest('#profileSaveCardBtn')) {
    event.preventDefault();
    saveProfileCard();
    return;
  }

  if (event.target.closest('#profileAddUpiBtn')) {
    event.preventDefault();
    toggleProfileUpiForm();
    return;
  }

  if (event.target.closest('#profileCancelUpiBtn')) {
    event.preventDefault();
    closeProfileUpiForm();
    return;
  }

  if (event.target.closest('#profileSaveUpiBtn')) {
    event.preventDefault();
    saveProfileUpi();
    return;
  }

  const orderCancelBtn = event.target.closest('[data-profile-order-cancel]');
  if (orderCancelBtn) {
    event.preventDefault();
    showOrderCancelModal(
      orderCancelBtn.dataset.profileOrderCancel,
      Number(orderCancelBtn.dataset.profileOrderItem)
    );
    return;
  }

  const profileRemoveBtn = event.target.closest('[data-profile-remove-address]');
  if (profileRemoveBtn) {
    event.preventDefault();
    removeAddress(Number(profileRemoveBtn.dataset.profileRemoveAddress));
    return;
  }

  const profileEditBtn = event.target.closest('[data-profile-edit-address]');
  if (profileEditBtn) {
    event.preventDefault();
    fillProfileAddressForm(Number(profileEditBtn.dataset.profileEditAddress));
    return;
  }

  const profileAddressCard = event.target.closest('[data-profile-address-card]');
  if (profileAddressCard) {
    event.preventDefault();
    window.activeProfileAddressId =
      Number(profileAddressCard.dataset.profileAddressCard);
    renderProfileAddresses();
    return;
  }

  const profileRemoveCardBtn = event.target.closest('[data-profile-remove-card]');
  if (profileRemoveCardBtn) {
    event.preventDefault();
    removeSavedCard(Number(profileRemoveCardBtn.dataset.profileRemoveCard));
    return;
  }

  const profileEditCardBtn = event.target.closest('[data-profile-edit-card]');
  if (profileEditCardBtn) {
    event.preventDefault();
    fillProfileCardForm(Number(profileEditCardBtn.dataset.profileEditCard));
    return;
  }

  const profileCard = event.target.closest('[data-profile-card]');
  if (profileCard) {
    event.preventDefault();
    window.activeProfileCardId = Number(profileCard.dataset.profileCard);
    renderProfileCards();
    return;
  }

  const profileRemoveUpiBtn = event.target.closest('[data-profile-remove-upi]');
  if (profileRemoveUpiBtn) {
    event.preventDefault();
    removeSavedUpi(Number(profileRemoveUpiBtn.dataset.profileRemoveUpi));
    return;
  }

  const profileEditUpiBtn = event.target.closest('[data-profile-edit-upi]');
  if (profileEditUpiBtn) {
    event.preventDefault();
    fillProfileUpiForm(Number(profileEditUpiBtn.dataset.profileEditUpi));
    return;
  }

  const profileUpi = event.target.closest('[data-profile-upi]');
  if (profileUpi) {
    event.preventDefault();
    window.activeProfileUpiId = Number(profileUpi.dataset.profileUpi);
    renderProfileUpis();
    return;
  }

  const checkoutRemoveBtn = event.target.closest('[data-checkout-remove-address]');
  if (checkoutRemoveBtn) {
    event.preventDefault();
    removeAddress(Number(checkoutRemoveBtn.dataset.checkoutRemoveAddress));
    return;
  }

  const checkoutEditBtn = event.target.closest('[data-checkout-edit-address]');
  if (checkoutEditBtn) {
    event.preventDefault();
    editAddress(Number(checkoutEditBtn.dataset.checkoutEditAddress));
  }
});

/* ================= ADDRESSES AND DAILY DELIVERY SUMMARY =================
   Saved addresses local/Supabase sync helpers aur home screen daily delivery card.
   Daily delivery card active subscription products ko today ke hisaab se show karta hai.
*/
function getSavedAddresses() {
  return mrNormalizeSavedAddresses(mrReadSavedAddresses()).filter(address =>
    address &&
    address.id &&
    address.name &&
    address.mobile &&
    address.house &&
    address.street &&
    address.town &&
    address.city &&
    address.state &&
    address.pin
  );
}

function setSavedAddresses(addresses, { sync = true } = {}) {
  mrSaveSavedAddresses(mrNormalizeSavedAddresses(addresses), { sync });
}

function formatDailyDeliveryDate(date = new Date()) {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).replace(/ /g, ' ');
}

function getStartOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDeliveryDate(value) {
  if (!value) return null;
  const localDateMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (localDateMatch) {
    return new Date(
      Number(localDateMatch[1]),
      Number(localDateMatch[2]) - 1,
      Number(localDateMatch[3])
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return getStartOfDay(date);
}

function isSameDeliveryDay(firstDate, secondDate) {
  const first = getStartOfDay(firstDate);
  const second = getStartOfDay(secondDate);
  return first.getTime() === second.getTime();
}

function isProductDeliveredOnDate(item, date) {
  const target = formatLocalDateInput(getStartOfDay(date));
  return (item?.deliveredDates || []).some(value => {
    const deliveredDate = parseDeliveryDate(value);
    return deliveredDate && formatLocalDateInput(deliveredDate) === target;
  });
}

function getNextProductDeliveryDate(item, today = getStartOfDay(new Date())) {
  const startDate = parseDeliveryDate(item.start) || parseDeliveryDate(item.orderedAt);
  const endDate = parseDeliveryDate(item.end);

  if (!startDate && !endDate) return null;
  if (endDate && endDate < today) return null;
  const firstDeliveryDate = startDate && startDate > today ? startDate : today;
  const maxLookaheadDate = endDate || new Date(
    firstDeliveryDate.getFullYear(),
    firstDeliveryDate.getMonth(),
    firstDeliveryDate.getDate() + 366
  );

  for (
    let date = new Date(firstDeliveryDate);
    date <= maxLookaheadDate;
    date.setDate(date.getDate() + 1)
  ) {
    if (!isDeliveryPausedOnDate(item, date) && !isProductDeliveredOnDate(item, date)) {
      return getStartOfDay(date);
    }
  }

  return null;
}

function isActiveSubscriptionProduct(item, today = getStartOfDay(new Date())) {
  const subscriptionPlans = new Set(["Monthly", "Weekly", "15 Days", "Customised"]);
  const plan = String(item?.plan || "").trim();
  const endDate = parseDeliveryDate(item?.end);

  if (!subscriptionPlans.has(plan)) return false;
  if (item?.cancelled) return false;
  return !endDate || endDate >= today;
}

function getHomeDeliveryProducts() {
  const today = getStartOfDay(new Date());
  const demoItem = getProfileSubscriptionDemoItem();
  const demoDeliveryItem = {
    ...demoItem,
    nextDeliveryDate: getNextProductDeliveryDate(demoItem, today)
  };
  const deliveryItems = [
    demoDeliveryItem,
    ...getPlacedOrders()
    .flatMap(order => (order.items || [])
      .filter(item => isActiveSubscriptionProduct(item, today))
      .map((item, itemIndex) => ({
        ...item,
        orderId: order.id,
        orderedAt: order.orderedAt,
        itemIndex,
        nextDeliveryDate: getNextProductDeliveryDate(item, today)
      }))
    )
  ]
    .filter(item => item.nextDeliveryDate)
    .map(item => item.isDemo ? item : applyDeliveryControlsToProduct(item, item.nextDeliveryDate));

  if (deliveryItems.length === 0) {
    return {
      title: 'Your Subscribed Products',
      products: [],
      deliveryDate: null
    };
  }

  deliveryItems.sort((a, b) => a.nextDeliveryDate - b.nextDeliveryDate);
  const nearestDate = deliveryItems[0].nextDeliveryDate;

  return {
    title: 'Your Products for Delivery',
    deliveryDate: nearestDate,
    products: deliveryItems
  };
}

function saveSelectedCartAsSubscribedProducts() {
  const cart = JSON.parse(localStorage.getItem('cart')) || [];
  loadSelectedCartItems();

  const selectedProducts = getCheckoutItems(cart);
  if (selectedProducts.length === 0) return;

  const existing =
    JSON.parse(localStorage.getItem('subscribedProducts')) || [];

  const merged = [...existing];

  selectedProducts.forEach(product => {
    const exists = merged.some(item =>
      item.name === product.name &&
      item.quantity === product.quantity &&
      item.slot === product.slot &&
      item.plan === product.plan
    );

    if (!exists) {
      merged.push({
        ...product,
        subscribedOn: new Date().toISOString()
      });
    }
  });

  localStorage.setItem('subscribedProducts', JSON.stringify(merged));
}

function showAllProductsFilter() {
  filterButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === 'all');
  });

  productSections.forEach(section => {
    section.style.display = 'block';
  });

  setActiveScreen('products');
}

function renderDailyDeliveryCard() {
  const card = document.getElementById('dailyDeliveryCard');
  const dateEl = document.getElementById('dailyDeliveryDate');
  const statusEl = document.getElementById('dailyDeliveryStatus');
  const titleEl = document.getElementById('dailyDeliveryTitle');
  const listEl = document.getElementById('dailyProductList');

  if (!card || !dateEl || !statusEl || !titleEl || !listEl) return;

  const loggedIn = localStorage.getItem('isLoggedIn') === 'true';
  const { title, products, deliveryDate } = getHomeDeliveryProducts();
  const hasActivePlans = products.length > 0;
  card.hidden = !loggedIn || !hasActivePlans;

  if (!loggedIn || !hasActivePlans) {
    listEl.innerHTML = "";
    return;
  }

  if (!deliveryDate || products.length === 0) {
    card.hidden = true;
    listEl.innerHTML = "";
    return;
  }

  const today = getStartOfDay(new Date());
  dateEl.textContent = formatDailyDeliveryDate(deliveryDate);
  statusEl.textContent = isSameDeliveryDay(deliveryDate, today)
    ? 'Delivery scheduled for today'
    : `Nearest delivery scheduled for ${formatDailyDeliveryDate(deliveryDate)}`;
  titleEl.textContent = title;

  listEl.innerHTML = products.map((item, index) => `
    <article class="daily-product-card ${item.isDemo ? "demo" : ""}" data-daily-product-index="${index}">
      ${item.isDemo ? '<span class="daily-product-demo-badge">Example</span>' : ''}
      <img src="${getCartProductImagePath(item)}" alt="${item.name || 'Product'}">
      <strong>${item.name || 'Product'}</strong>
      <small>${isSameDeliveryDay(item.nextDeliveryDate, today) ? 'Today' : formatDailyDeliveryDate(item.nextDeliveryDate)}</small>
      <span class="daily-delivery-control">(i) Delivery Controls</span>
    </article>
  `).join("");

  const carousel = listEl.closest('.daily-product-carousel');
  const canScroll = listEl.scrollWidth > listEl.clientWidth;
  carousel?.classList.toggle('is-scrollable', canScroll);
}

/* ================= DELIVERY CONTROLS =================
   Subscription ke product par pause, product switch, slot change, address change
   jaise controls yaha calculate/save/render hote hain.
*/
function productFromCard(card) {
  if (!card) return null;

  return {
    name: card.querySelector('h3')?.textContent.trim() || "Product",
    price: card.querySelector('strong')?.textContent.trim() || "Price not selected",
    image: normalizeAssetPath(card.querySelector('img')?.getAttribute('src') || card.querySelector('img')?.src),
    plan: "Not selected",
    quantity: "Not selected",
    packets: "1",
    start: "",
    end: "",
    slot: "Not selected"
  };
}

function getDeliveryProductOptions() {
  const cards = Array.from(document.querySelectorAll('#products-screen .product-card'));
  return cards.map(card => productFromCard(card)).filter(Boolean);
}

function getDeliveryProductKey(product) {
  return [
    product?.name || "product",
    product?.quantity || "",
    product?.slot || "",
    product?.plan || ""
  ].join('|');
}

function formatControlDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function getTomorrowControlDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return getIsoLocalDate(date);
}

let activeDeliveryProduct = null;
let selectedDeliveryPauseDates = [];
let selectedDeliverySwitchDates = [];
let selectedDeliveryQuantityDates = [];
let selectedDeliverySlotDates = [];
let selectedDeliveryAddressDates = [];
let removedDeliveryPauseDates = [];
let removedDeliveryControlKeys = [];
let deliveryControlsDirty = false;
let deliveryCalendarOpen = {
  dcPauseMode: false,
  dcSwitchMode: false,
  dcQuantityMode: false,
  dcSlotMode: false,
  dcAddressMode: false
};

function getDeliveryControlKey(type, date) {
  return `${type}|${date}`;
}

function setDeliveryControlRemoved(type, date, removed) {
  const key = getDeliveryControlKey(type, date);
  const keys = new Set(removedDeliveryControlKeys);
  if (removed) keys.add(key);
  else keys.delete(key);
  removedDeliveryControlKeys = [...keys];
}

function markDeliveryControlsDirty() {
  deliveryControlsDirty = true;
  updateDeliverySaveButton();
}

function getMilkCashTransactions() {
  try {
    return JSON.parse(localStorage.getItem("milkCashTransactions")) || [];
  } catch (error) {
    return [];
  }
}

function setMilkCashTransactions(transactions = []) {
  localStorage.setItem("milkCashTransactions", JSON.stringify(transactions || []));
}

function getMilkCashBalance() {
  return getMilkCashTransactions().reduce(
    (sum, transaction) => sum + (Number(transaction.amount) || 0),
    0
  );
}

function addMilkCashTransaction(transaction) {
  const transactions = getMilkCashTransactions();
  transactions.unshift({
    id: transaction.id || `MC${Date.now()}${Math.floor(Math.random() * 1000)}`,
    createdAt: transaction.createdAt || new Date().toISOString(),
    type: Number(transaction.amount) >= 0 ? "credit" : "debit",
    ...transaction,
    amount: Number(transaction.amount) || 0
  });
  setMilkCashTransactions(transactions);
  renderWallet();
}

function renderWallet() {
  const balanceEl = document.getElementById("walletBalanceAmount");
  if (balanceEl) balanceEl.textContent = formatPaymentCurrency(getMilkCashBalance());
}

function renderWalletTransactions() {
  const listEl = document.getElementById("walletTransactionsList");
  if (!listEl) return;

  const milkCashTransactions = getMilkCashTransactions();
  const milkCashCredit = milkCashTransactions
    .filter(transaction => Number(transaction.amount) > 0)
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const milkCashUsed = milkCashTransactions
    .filter(transaction => Number(transaction.amount) < 0)
    .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount)), 0);

  if (milkCashTransactions.length === 0) {
    listEl.innerHTML = `
      <div class="wallet-empty-state">
        No wallet transactions yet.
      </div>
    `;
    return;
  }

  listEl.innerHTML = `
    <section class="wallet-billing-summary">
      <div>
        <span>Wallet Balance</span>
        <strong>${formatPaymentCurrency(getMilkCashBalance())}</strong>
      </div>
      <div>
        <span>Wallet Credit</span>
        <strong>${formatPaymentCurrency(milkCashCredit)}</strong>
      </div>
      <div>
        <span>Wallet Used</span>
        <strong>${formatPaymentCurrency(milkCashUsed)}</strong>
      </div>
    </section>

    ${milkCashTransactions.map(transaction => {
      const amount = Number(transaction.amount) || 0;
      const sign = amount >= 0 ? "+" : "-";
      const dateText = formatOrderDate(transaction.createdAt);
      return `
      <article class="wallet-transaction ${amount >= 0 ? "credit" : "debit"}">
        <div>
          <h3>${transaction.title || "Wallet Transaction"}</h3>
          <p>${transaction.note || ""}</p>
          ${transaction.effectiveDate ? `<p class="wallet-transaction-meta">Effective: ${formatControlDate(transaction.effectiveDate)}</p>` : ""}
          <small>${dateText}</small>
        </div>
        <strong>${sign}${formatPaymentCurrency(Math.abs(amount))}</strong>
      </article>
    `}).join("")}
  `;
}

function getIsoLocalDate(date = new Date()) {
  const localDate = getStartOfDay(date);
  return [
    localDate.getFullYear(),
    String(localDate.getMonth() + 1).padStart(2, "0"),
    String(localDate.getDate()).padStart(2, "0")
  ].join("-");
}

function getDeliveryControlEffectiveDate(mode, inputId) {
  if (mode === "tomorrow") return getTomorrowControlDate();
  if (mode === "date") return document.getElementById(inputId)?.value || "";
  return "";
}

function normalizeDeliveryControls(controls = []) {
  return (Array.isArray(controls) ? controls : [])
    .filter(control => control && control.type && control.effectiveDate)
    .map(control => ({
      type: String(control.type || ""),
      effectiveDate: String(control.effectiveDate || ""),
      effectiveDateLabel: control.effectiveDateLabel || formatControlDate(control.effectiveDate),
      value: control.value ?? true,
      actionLabel: control.actionLabel || getDeliveryControlActionLabel(control),
      adminNote: control.adminNote || getDeliveryControlAdminNote(control),
      createdAt: control.createdAt || new Date().toISOString(),
      status: control.status || "active"
    }));
}

function getDeliveryControlActionLabel(control) {
  if (control?.type === "pause") return "Pause Delivery";
  if (control?.type === "switch_product") return "Switch Product";
  if (control?.type === "quantity") return "Change Quantity";
  if (control?.type === "slot") return "Change Slot";
  if (control?.type === "address") return "Change Address";
  return "Delivery Control";
}

function getDeliveryControlAdminNote(control) {
  const dateText = formatControlDate(control?.effectiveDate);

  if (control?.type === "pause") {
    return `Pause delivery on ${dateText}`;
  }

  if (control?.type === "switch_product") {
    return `Switch product to ${control.value?.productName || "selected product"} from ${dateText}`;
  }

  if (control?.type === "quantity") {
    return `Change quantity to ${control.value?.packets || 1} packet(s) on ${dateText}`;
  }

  if (control?.type === "slot") {
    return `Change delivery slot to ${control.value?.slot || "selected slot"} from ${dateText}`;
  }

  if (control?.type === "address") {
    return `Change delivery address to ${control.value?.addressText || "selected saved address"} from ${dateText}`;
  }

  return `Delivery control active from ${dateText}`;
}

function getDeliveryControlsSummaryText(controls = []) {
  const activeControls = normalizeDeliveryControls(controls)
    .filter(control => control.status !== "cancelled");

  if (activeControls.length === 0) return "";

  return activeControls
    .map((control, index) => `${index + 1}. ${control.adminNote}`)
    .join("\n");
}

function getActiveDeliveryControls(item) {
  return normalizeDeliveryControls(item?.deliveryControls)
    .filter(control => control.status !== "cancelled");
}

function isDeliveryPausedOnDate(item, date = getStartOfDay(new Date())) {
  const targetDate = getIsoLocalDate(date);
  return getActiveDeliveryControls(item).some(control =>
    control.type === "pause" &&
    control.effectiveDate === targetDate &&
    control.value !== false
  );
}

function getLatestDeliveryControl(item, type, date = getStartOfDay(new Date())) {
  const targetDate = getIsoLocalDate(date);
  return getActiveDeliveryControls(item)
    .filter(control =>
      control.type === type &&
      String(control.effectiveDate || "") <= targetDate
    )
    .sort((a, b) =>
      String(b.effectiveDate).localeCompare(String(a.effectiveDate)) ||
      String(b.createdAt).localeCompare(String(a.createdAt))
    )[0] || null;
}

function getProductOptionByName(name) {
  const normalizedName = normalizeProductName(name);
  return getDeliveryProductOptions().find(item =>
    normalizeProductName(item.name) === normalizedName
  ) || null;
}

function applyDeliveryControlsToProduct(item, date = getStartOfDay(new Date())) {
  const effectiveItem = { ...item };
  const switchControl = getLatestDeliveryControl(item, "switch_product", date);
  const quantityControl = getLatestDeliveryControl(item, "quantity", date);
  const slotControl = getLatestDeliveryControl(item, "slot", date);
  const addressControl = getLatestDeliveryControl(item, "address", date);

  if (switchControl?.value?.productName) {
    const switchedProduct = getProductOptionByName(switchControl.value.productName);
    effectiveItem.name = switchControl.value.productName;
    if (switchedProduct?.image) effectiveItem.image = switchedProduct.image;
    if (switchedProduct?.price) effectiveItem.price = switchedProduct.price;
  }

  if (slotControl?.value?.slot) {
    effectiveItem.slot = slotControl.value.slot;
  }

  if (quantityControl?.value?.packets) {
    effectiveItem.packets = Number(quantityControl.value.packets) || effectiveItem.packets;
  }

  if (addressControl?.value?.addressId) {
    effectiveItem.deliveryAddressId = addressControl.value.addressId;
    effectiveItem.deliveryAddressText = addressControl.value.addressText || "";
  }

  effectiveItem.deliveryControls = getActiveDeliveryControls(item);
  return effectiveItem;
}

function collectDeliveryControlChanges() {
  const createdAt = new Date().toISOString();
  const controls = [];

  const existingPauseDates = new Set(
    getActiveDeliveryControls(activeDeliveryProduct)
      .filter(control => control.type === "pause" && control.value !== false)
      .map(control => control.effectiveDate)
  );
  const pauseDates = getPauseDeliveryDates()
    .filter(date => !existingPauseDates.has(date));
  if (pauseDates.length) {
    pauseDates.forEach(pauseDate => controls.push({
      type: "pause",
      effectiveDate: pauseDate,
      value: true,
      createdAt,
      status: "active"
    }));
  }

  const switchModes = getCheckedControlValues('dcSwitchMode');
  const switchTomorrowDate = getSwitchDeliveryDates().includes(getTomorrowControlDate())
    ? getTomorrowControlDate()
    : "";
  const switchTomorrowProduct = selectedProductLabel("tomorrow");
  if (switchModes.includes("tomorrow") && switchTomorrowDate && switchTomorrowProduct) {
    controls.push({
      type: "switch_product",
      effectiveDate: switchTomorrowDate,
      value: { productName: switchTomorrowProduct },
      createdAt,
      status: "active"
    });
  }

  const switchDateProduct = selectedProductLabel("date");
  if (switchDateProduct) {
    selectedDeliverySwitchDates.forEach(switchDate => controls.push({
      type: "switch_product",
      effectiveDate: switchDate,
      value: { productName: switchDateProduct },
      createdAt,
      status: "active"
    }));
  }

  const quantityModes = getCheckedControlValues('dcQuantityMode');
  const quantityTomorrowDate = getQuantityDeliveryDates().includes(getTomorrowControlDate())
    ? getTomorrowControlDate()
    : "";
  const quantityTomorrowPackets = document.getElementById('dcQuantityTomorrow')?.value;
  if (quantityModes.includes("tomorrow") && quantityTomorrowDate && quantityTomorrowPackets) {
    controls.push({
      type: "quantity",
      effectiveDate: quantityTomorrowDate,
      value: { packets: Number(quantityTomorrowPackets) || 1 },
      createdAt,
      status: "active"
    });
  }

  const quantityDatePackets = document.getElementById('dcQuantityDateValue')?.value;
  if (quantityDatePackets) {
    selectedDeliveryQuantityDates.forEach(quantityDate => controls.push({
      type: "quantity",
      effectiveDate: quantityDate,
      value: { packets: Number(quantityDatePackets) || 1 },
      createdAt,
      status: "active"
    }));
  }

  const slotModes = getCheckedControlValues('dcSlotMode');
  const slotTomorrow = document.getElementById('dcSlotTomorrow')?.value;
  const slotTomorrowDate = getSlotDeliveryDates().includes(getTomorrowControlDate())
    ? getTomorrowControlDate()
    : "";
  if (slotModes.includes("tomorrow") && slotTomorrowDate && slotTomorrow) {
    controls.push({
      type: "slot",
      effectiveDate: slotTomorrowDate,
      value: { slot: slotTomorrow },
      createdAt,
      status: "active"
    });
  }

  const slotDateValue = document.getElementById('dcSlotDateValue')?.value;
  if (slotDateValue) {
    selectedDeliverySlotDates.forEach(slotDate => controls.push({
      type: "slot",
      effectiveDate: slotDate,
      value: { slot: slotDateValue },
      createdAt,
      status: "active"
    }));
  }

  const addressDates = getAddressDeliveryDates();
  const addressSelect = document.getElementById('dcAddressSelect');
  const addressId = addressSelect?.value || "";
  const addressText = addressSelect?.selectedOptions?.[0]?.textContent.trim() || "";
  if (addressId) {
    addressDates.forEach(addressDate => controls.push({
      type: "address",
      effectiveDate: addressDate,
      value: { addressId, addressText },
      createdAt,
      status: "active"
    }));
  }

  return controls;
}

function isDeliveryControlEligibleProduct(productOrName) {
  const name = typeof productOrName === "string"
    ? productOrName
    : productOrName?.name;

  return !/GHEE|PANEER/i.test(name || "");
}

function markOneTimeProductCards() {
  document.querySelectorAll('#products-screen .product-card').forEach(card => {
    const name = card.querySelector('h3')?.textContent || "";
    card.classList.toggle(
      'one-time-product',
      !isDeliveryControlEligibleProduct(name)
    );
  });
}

function populateDeliveryControlSelects(product) {
  const options = getDeliveryProductOptions();
  const productOptions = options.map(item => `
    <option value="${item.name}" ${item.name === product.name ? "selected" : ""}>
      ${item.name}
    </option>
  `).join("");

  ['dcSwitchProductTomorrow', 'dcSwitchProductDate'].forEach(id => {
    const select = document.getElementById(id);
    if (select) select.innerHTML = productOptions;
  });

  const addresses = getSavedAddresses();
  const addressSelect = document.getElementById('dcAddressSelect');
  if (addressSelect) {
    addressSelect.innerHTML = addresses.length
      ? addresses.map(address => `
          <option value="${address.id}">
            ${address.name} - ${address.house}, ${address.town}
          </option>
        `).join("")
      : '<option value="">No saved address</option>';
  }
}

function restoreSavedDeliveryControlSelections() {
  const controls = getActiveDeliveryControls(activeDeliveryProduct);
  const tomorrow = getTomorrowControlDate();
  const datesFor = type => controls
    .filter(control => control.type === type)
    .map(control => control.effectiveDate);
  const setMode = (name, value, checked) => {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = checked;
  };

  const pauseDates = datesFor("pause");
  const switchControls = controls.filter(control => control.type === "switch_product");
  const quantityControls = controls.filter(control => control.type === "quantity");
  const slotControls = controls.filter(control => control.type === "slot");
  const addressControls = controls.filter(control => control.type === "address");

  setMode("dcPauseMode", "tomorrow", pauseDates.includes(tomorrow));
  setMode("dcPauseMode", "date", pauseDates.some(date => date !== tomorrow));
  setSelectedPauseDates(pauseDates.filter(date => date !== tomorrow));

  setMode("dcSwitchMode", "tomorrow", switchControls.some(control => control.effectiveDate === tomorrow));
  setMode("dcSwitchMode", "date", switchControls.some(control => control.effectiveDate !== tomorrow));
  setSelectedSwitchDates(switchControls
    .filter(control => control.effectiveDate !== tomorrow)
    .map(control => control.effectiveDate));

  setMode("dcQuantityMode", "tomorrow", quantityControls.some(control => control.effectiveDate === tomorrow));
  setMode("dcQuantityMode", "date", quantityControls.some(control => control.effectiveDate !== tomorrow));
  setSelectedQuantityDates(quantityControls
    .filter(control => control.effectiveDate !== tomorrow)
    .map(control => control.effectiveDate));

  setMode("dcSlotMode", "tomorrow", slotControls.some(control => control.effectiveDate === tomorrow));
  setMode("dcSlotMode", "date", slotControls.some(control => control.effectiveDate !== tomorrow));
  setSelectedSlotDates(slotControls
    .filter(control => control.effectiveDate !== tomorrow)
    .map(control => control.effectiveDate));

  setMode("dcAddressMode", "tomorrow", addressControls.some(control => control.effectiveDate === tomorrow));
  setMode("dcAddressMode", "date", addressControls.some(control => control.effectiveDate !== tomorrow));
  setSelectedAddressDates(addressControls
    .filter(control => control.effectiveDate !== tomorrow)
    .map(control => control.effectiveDate));

  const setSelect = (id, value) => {
    const select = document.getElementById(id);
    if (select && value !== undefined && value !== null) select.value = String(value);
  };
  const tomorrowControl = (list, type) =>
    list.find(control => control.effectiveDate === tomorrow)?.value?.[type];
  const datedControl = (list, type) =>
    list.find(control => control.effectiveDate !== tomorrow)?.value?.[type];

  setSelect("dcSwitchProductTomorrow", tomorrowControl(switchControls, "productName"));
  setSelect("dcSwitchProductDate", datedControl(switchControls, "productName"));
  setSelect("dcQuantityTomorrow", tomorrowControl(quantityControls, "packets"));
  setSelect("dcQuantityDateValue", datedControl(quantityControls, "packets"));
  setSelect("dcSlotTomorrow", tomorrowControl(slotControls, "slot"));
  setSelect("dcSlotDateValue", datedControl(slotControls, "slot"));
  setSelect(
    "dcAddressSelect",
    tomorrowControl(addressControls, "addressId") ||
      datedControl(addressControls, "addressId")
  );
}

function openDeliveryControls(product) {
  if (!product) return;

  if (!isLoggedIn) {
    setActiveScreen("login");
    return;
  }

  activeDeliveryProduct = {
    name: product.name || "Product",
    price: product.price || "Price not selected",
    image: product.image || "",
    plan: product.plan || "Not selected",
    quantity: product.quantity || "Not selected",
    packets: product.packets || "1",
    start: product.start || "",
    end: product.end || "",
    slot: product.slot || "Not selected",
    deliveredDates: Array.isArray(product.deliveredDates) ? product.deliveredDates : [],
    orderId: product.orderId || "",
    itemIndex: Number.isInteger(product.itemIndex) ? product.itemIndex : null,
    deliveryControls: getActiveDeliveryControls(product),
    key: getDeliveryProductKey(product)
  };

  document.getElementById('dcProductImage').src = getCartProductImagePath(activeDeliveryProduct);
  document.getElementById('dcSummaryImage').src = getCartProductImagePath(activeDeliveryProduct);
  document.getElementById('dcSummaryName').textContent = activeDeliveryProduct.name;
  document.getElementById('dcSummaryPrice').textContent = activeDeliveryProduct.price;
  document.getElementById('dcSummaryPlan').textContent = activeDeliveryProduct.plan;
  document.getElementById('dcSummaryQuantity').textContent = activeDeliveryProduct.quantity;
  document.getElementById('dcSummaryPackets').textContent = activeDeliveryProduct.packets;
  document.getElementById('dcSummarySlot').textContent = activeDeliveryProduct.slot;
  document.getElementById('dcSummaryStart').textContent = formatControlDate(activeDeliveryProduct.start);
  document.getElementById('dcSummaryEnd').textContent = formatControlDate(activeDeliveryProduct.end);

  populateDeliveryControlSelects(activeDeliveryProduct);

  document.querySelectorAll('#delivery-controls-screen input[type="radio"]').forEach(input => {
    input.checked = false;
  });
  document.querySelectorAll('#delivery-controls-screen input[name="dcPauseMode"]').forEach(input => {
    input.checked = false;
  });
  document.querySelectorAll('#delivery-controls-screen input[name="dcSwitchMode"]').forEach(input => {
    input.checked = false;
  });
  document.querySelectorAll('#delivery-controls-screen input[name="dcQuantityMode"]').forEach(input => {
    input.checked = false;
  });
  document.querySelectorAll('#delivery-controls-screen input[name="dcSlotMode"]').forEach(input => {
    input.checked = false;
  });
  document.querySelectorAll('#delivery-controls-screen input[name="dcAddressMode"]').forEach(input => {
    input.checked = false;
  });
  setSelectedPauseDates([]);
  setSelectedSwitchDates([]);
  setSelectedQuantityDates([]);
  setSelectedSlotDates([]);
  setSelectedAddressDates([]);
  removedDeliveryPauseDates = [];
  removedDeliveryControlKeys = [];
  deliveryControlsDirty = false;
  deliveryCalendarOpen = {
    dcPauseMode: false,
    dcSwitchMode: false,
    dcQuantityMode: false,
    dcSlotMode: false,
    dcAddressMode: false
  };

  ['dcPauseDate', 'dcSwitchDate', 'dcQuantityDate', 'dcSlotDate', 'dcAddressDate'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });

  const currentPackets = String(Number(activeDeliveryProduct.packets) || 1);
  const quantityTomorrow = document.getElementById('dcQuantityTomorrow');
  const quantityDateValue = document.getElementById('dcQuantityDateValue');
  if (quantityTomorrow) quantityTomorrow.value = currentPackets;
  if (quantityDateValue) quantityDateValue.value = currentPackets;

  const slotTomorrow = document.getElementById('dcSlotTomorrow');
  const slotDateValue = document.getElementById('dcSlotDateValue');
  if (slotTomorrow) slotTomorrow.value = activeDeliveryProduct.slot === "Evening" ? "Evening" : "Morning";
  if (slotDateValue) slotDateValue.value = activeDeliveryProduct.slot === "Evening" ? "Evening" : "Morning";
  restoreSavedDeliveryControlSelections();

  document
    .querySelector('.delivery-controls-shell')
    ?.classList.toggle(
      'one-time-controls',
      !isDeliveryControlEligibleProduct(activeDeliveryProduct)
    );

  updateDeliveryControlSummary();
  renderAllDeliveryControlCalendars();
  setActiveScreen('deliveryControls');
}

function getCheckedControlValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function getCheckedControlValues(name) {
  return Array
    .from(document.querySelectorAll(`input[name="${name}"]:checked`))
    .map(input => input.value);
}

function getDeliveryPlanDates(item) {
  const start = parseDeliveryDate(item?.start);
  const end = parseDeliveryDate(item?.end);
  if (!start || !end || end < start) return [];

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function getDeliveredDateKeys(item) {
  return new Set(
    (item?.deliveredDates || [])
      .map(value => {
        const date = parseDeliveryDate(value);
        return date ? getIsoLocalDate(date) : "";
      })
      .filter(Boolean)
  );
}

function setSelectedPauseDates(dates = []) {
  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);

  selectedDeliveryPauseDates = [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();

  const pauseDateInput = document.getElementById('dcPauseDate');
  if (pauseDateInput) pauseDateInput.value = selectedDeliveryPauseDates[0] || "";
}

function setSelectedSwitchDates(dates = []) {
  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);

  selectedDeliverySwitchDates = [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();

  const switchDateInput = document.getElementById('dcSwitchDate');
  if (switchDateInput) switchDateInput.value = selectedDeliverySwitchDates[0] || "";
}

function setSelectedQuantityDates(dates = []) {
  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);

  selectedDeliveryQuantityDates = [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();

  const quantityDateInput = document.getElementById('dcQuantityDate');
  if (quantityDateInput) quantityDateInput.value = selectedDeliveryQuantityDates[0] || "";
}

function setSelectedSlotDates(dates = []) {
  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);

  selectedDeliverySlotDates = [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();

  const slotDateInput = document.getElementById('dcSlotDate');
  if (slotDateInput) slotDateInput.value = selectedDeliverySlotDates[0] || "";
}

function setSelectedAddressDates(dates = []) {
  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);

  selectedDeliveryAddressDates = [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();

  const addressDateInput = document.getElementById('dcAddressDate');
  if (addressDateInput) addressDateInput.value = selectedDeliveryAddressDates[0] || "";
}

function getPauseDeliveryDates() {
  const pauseModes = getCheckedControlValues('dcPauseMode');
  const dates = [];

  getActiveDeliveryControls(activeDeliveryProduct)
    .filter(control => control.type === "pause" && control.value !== false)
    .forEach(control => dates.push(control.effectiveDate));
  if (pauseModes.includes("tomorrow")) dates.push(getTomorrowControlDate());
  dates.push(...selectedDeliveryPauseDates);

  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);
  const removedDateKeys = new Set(removedDeliveryPauseDates);
  const overrideDateKeys = new Set([
    ...getSwitchDeliveryDates(),
    ...getQuantityDeliveryDates(),
    ...getSlotDeliveryDates(),
    ...getAddressDeliveryDates()
  ]);

  return [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      !removedDateKeys.has(dateKey) &&
      !overrideDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();
}

function removePauseFromDate(dateKey) {
  if (!dateKey) return;

  const paused = new Set(selectedDeliveryPauseDates);
  paused.delete(dateKey);
  setSelectedPauseDates([...paused]);

  if (dateKey === getTomorrowControlDate()) {
    const tomorrowPause = document.querySelector('input[name="dcPauseMode"][value="tomorrow"]');
    if (tomorrowPause) tomorrowPause.checked = false;
  }

  if (getActiveDeliveryControls(activeDeliveryProduct).some(control =>
    control.type === "pause" &&
    control.value !== false &&
    control.effectiveDate === dateKey
  )) {
    removedDeliveryPauseDates = [...new Set([
      ...removedDeliveryPauseDates,
      dateKey
    ])];
  }
}

function updateTomorrowPauseIndicators() {
  const tomorrowPaused = getPauseDeliveryDates().includes(getTomorrowControlDate());
  document.querySelectorAll('[data-dc-pause-indicator="tomorrow"]').forEach(mark => {
    mark.classList.toggle('active', tomorrowPaused);
    mark.textContent = tomorrowPaused ? "||" : "";
    mark.title = tomorrowPaused ? "Delivery paused" : "";
  });
}

function renderAllDeliveryControlCalendars() {
  renderDeliveryPauseCalendar();
  renderDeliverySwitchCalendar();
  renderDeliveryQuantityCalendar();
  renderDeliverySlotCalendar();
  renderDeliveryAddressCalendar();
  updateTomorrowPauseIndicators();
}

function getSwitchDeliveryDates() {
  const switchModes = getCheckedControlValues('dcSwitchMode');
  const dates = [];

  if (switchModes.includes("tomorrow")) dates.push(getTomorrowControlDate());
  dates.push(...selectedDeliverySwitchDates);

  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);

  return [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();
}

function getQuantityDeliveryDates() {
  const quantityModes = getCheckedControlValues('dcQuantityMode');
  const dates = [];

  if (quantityModes.includes("tomorrow")) dates.push(getTomorrowControlDate());
  dates.push(...selectedDeliveryQuantityDates);

  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);

  return [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();
}

function getSlotDeliveryDates() {
  const slotModes = getCheckedControlValues('dcSlotMode');
  const dates = [];

  if (slotModes.includes("tomorrow")) dates.push(getTomorrowControlDate());
  dates.push(...selectedDeliverySlotDates);

  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);

  return [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();
}

function getAddressDeliveryDates() {
  const addressModes = getCheckedControlValues('dcAddressMode');
  const dates = [];

  if (addressModes.includes("tomorrow")) dates.push(getTomorrowControlDate());
  dates.push(...selectedDeliveryAddressDates);

  const planDateKeys = new Set(getDeliveryPlanDates(activeDeliveryProduct).map(getIsoLocalDate));
  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);

  return [...new Set(dates)]
    .map(value => {
      const date = parseDeliveryDate(value);
      return date ? getIsoLocalDate(date) : "";
    })
    .filter(dateKey =>
      dateKey &&
      !deliveredDateKeys.has(dateKey) &&
      (!planDateKeys.size || planDateKeys.has(dateKey))
    )
    .sort();
}

function getDeliveryCalendarControlDates() {
  const controls = getActiveDeliveryControls(activeDeliveryProduct).filter(control =>
    !removedDeliveryControlKeys.includes(
      getDeliveryControlKey(control.type, control.effectiveDate)
    )
  );
  const datesFor = type => new Set(
    controls
      .filter(control => control.type === type)
      .map(control => control.effectiveDate)
      .filter(Boolean)
  );
  const switchDates = datesFor("switch_product");
  const quantityDates = datesFor("quantity");
  const slotDates = datesFor("slot");
  const addressDates = datesFor("address");

  getSwitchDeliveryDates().forEach(date => switchDates.add(date));
  getQuantityDeliveryDates().forEach(date => quantityDates.add(date));
  getSlotDeliveryDates().forEach(date => slotDates.add(date));
  getAddressDeliveryDates().forEach(date => addressDates.add(date));

  return {
    pause: new Set(getPauseDeliveryDates()),
    switchProduct: switchDates,
    quantity: quantityDates,
    slot: slotDates,
    address: addressDates
  };
}

function renderDeliveryCalendarMarks(dateKey, delivered, controlDates) {
  if (delivered) return '<span class="dc-date-marks"><b>✓</b></span>';

  const marks = [
    controlDates.pause.has(dateKey)
      ? '<b class="pause-mark" title="Pause Delivery">||</b>'
      : "",
    controlDates.switchProduct.has(dateKey)
      ? '<b class="switch-mark" title="Switch Product">↻</b>'
      : "",
    controlDates.quantity.has(dateKey)
      ? '<b class="quantity-mark" title="Change Quantity">＋</b>'
      : "",
    controlDates.slot.has(dateKey)
      ? '<b class="slot-mark" title="Change Slot">○</b>'
      : "",
    controlDates.address.has(dateKey)
      ? '<b class="address-mark" title="Change Address">📍</b>'
      : ""
  ].filter(Boolean);

  return marks.length
    ? `<span class="dc-date-marks">${marks.join("")}</span>`
    : "";
}

function renderDeliveryPauseCalendar() {
  const calendar = document.getElementById('dcPauseCalendar');
  if (!calendar || !activeDeliveryProduct) return;

  const isOpen = deliveryCalendarOpen.dcPauseMode;
  calendar.classList.toggle('open', isOpen);

  const dates = getDeliveryPlanDates(activeDeliveryProduct);
  if (dates.length === 0) {
    calendar.innerHTML = `<p class="dc-pause-calendar-empty">Subscription dates not selected.</p>`;
    return;
  }

  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);
  const selectedDateKeys = new Set(getPauseDeliveryDates());
  const controlDates = getDeliveryCalendarControlDates();

  calendar.innerHTML = `
    <div class="dc-pause-calendar-head">
      <strong>${activeDeliveryProduct.plan || "Plan"} Calendar</strong>
      <span>${formatControlDate(activeDeliveryProduct.start)} - ${formatControlDate(activeDeliveryProduct.end)}</span>
    </div>
    <div class="dc-pause-calendar-grid">
      ${dates.map(date => {
        const dateKey = getIsoLocalDate(date);
        const delivered = deliveredDateKeys.has(dateKey);
        const selected = selectedDateKeys.has(dateKey);
        return `
          <button
            class="dc-pause-date ${delivered ? "delivered" : ""} ${selected ? "selected" : ""}"
            type="button"
            data-dc-pause-date="${dateKey}"
            ${delivered ? "disabled" : ""}
          >
            <small>${date.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
            <strong>${date.getDate()}</strong>
            ${renderDeliveryCalendarMarks(dateKey, delivered, controlDates)}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderDeliverySwitchCalendar() {
  const calendar = document.getElementById('dcSwitchCalendar');
  if (!calendar || !activeDeliveryProduct) return;

  const isOpen = deliveryCalendarOpen.dcSwitchMode;
  calendar.classList.toggle('open', isOpen);

  const dates = getDeliveryPlanDates(activeDeliveryProduct);
  if (dates.length === 0) {
    calendar.innerHTML = `<p class="dc-pause-calendar-empty">Subscription dates not selected.</p>`;
    return;
  }

  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);
  const selectedDateKeys = new Set(getSwitchDeliveryDates());
  const pausedDateKeys = new Set(getPauseDeliveryDates());
  const controlDates = getDeliveryCalendarControlDates();

  calendar.innerHTML = `
    <div class="dc-pause-calendar-head">
      <strong>${activeDeliveryProduct.plan || "Plan"} Calendar</strong>
      <span>${formatControlDate(activeDeliveryProduct.start)} - ${formatControlDate(activeDeliveryProduct.end)}</span>
    </div>
    <div class="dc-pause-calendar-grid">
      ${dates.map(date => {
        const dateKey = getIsoLocalDate(date);
        const delivered = deliveredDateKeys.has(dateKey);
        const selected = selectedDateKeys.has(dateKey);
        const paused = pausedDateKeys.has(dateKey);
        return `
          <button
            class="dc-pause-date ${delivered ? "delivered" : ""} ${paused ? "paused" : ""} ${selected ? "selected switch-selected" : ""}"
            type="button"
            data-dc-switch-date="${dateKey}"
            ${delivered ? "disabled" : ""}
          >
            <small>${date.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
            <strong>${date.getDate()}</strong>
            ${renderDeliveryCalendarMarks(dateKey, delivered, controlDates)}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderDeliveryQuantityCalendar() {
  const calendar = document.getElementById('dcQuantityCalendar');
  if (!calendar || !activeDeliveryProduct) return;

  const isOpen = deliveryCalendarOpen.dcQuantityMode;
  calendar.classList.toggle('open', isOpen);

  const dates = getDeliveryPlanDates(activeDeliveryProduct);
  if (dates.length === 0) {
    calendar.innerHTML = `<p class="dc-pause-calendar-empty">Subscription dates not selected.</p>`;
    return;
  }

  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);
  const selectedDateKeys = new Set(getQuantityDeliveryDates());
  const pausedDateKeys = new Set(getPauseDeliveryDates());
  const controlDates = getDeliveryCalendarControlDates();

  calendar.innerHTML = `
    <div class="dc-pause-calendar-head">
      <strong>${activeDeliveryProduct.plan || "Plan"} Calendar</strong>
      <span>${formatControlDate(activeDeliveryProduct.start)} - ${formatControlDate(activeDeliveryProduct.end)}</span>
    </div>
    <div class="dc-pause-calendar-grid">
      ${dates.map(date => {
        const dateKey = getIsoLocalDate(date);
        const delivered = deliveredDateKeys.has(dateKey);
        const selected = selectedDateKeys.has(dateKey);
        const paused = pausedDateKeys.has(dateKey);
        return `
          <button
            class="dc-pause-date ${delivered ? "delivered" : ""} ${paused ? "paused" : ""} ${selected ? "selected quantity-selected" : ""}"
            type="button"
            data-dc-quantity-date="${dateKey}"
            ${delivered ? "disabled" : ""}
          >
            <small>${date.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
            <strong>${date.getDate()}</strong>
            ${renderDeliveryCalendarMarks(dateKey, delivered, controlDates)}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderDeliverySlotCalendar() {
  const calendar = document.getElementById('dcSlotCalendar');
  if (!calendar || !activeDeliveryProduct) return;

  const isOpen = deliveryCalendarOpen.dcSlotMode;
  calendar.classList.toggle('open', isOpen);

  const dates = getDeliveryPlanDates(activeDeliveryProduct);
  if (dates.length === 0) {
    calendar.innerHTML = `<p class="dc-pause-calendar-empty">Subscription dates not selected.</p>`;
    return;
  }

  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);
  const selectedDateKeys = new Set(getSlotDeliveryDates());
  const pausedDateKeys = new Set(getPauseDeliveryDates());
  const controlDates = getDeliveryCalendarControlDates();

  calendar.innerHTML = `
    <div class="dc-pause-calendar-head">
      <strong>${activeDeliveryProduct.plan || "Plan"} Calendar</strong>
      <span>${formatControlDate(activeDeliveryProduct.start)} - ${formatControlDate(activeDeliveryProduct.end)}</span>
    </div>
    <div class="dc-pause-calendar-grid">
      ${dates.map(date => {
        const dateKey = getIsoLocalDate(date);
        const delivered = deliveredDateKeys.has(dateKey);
        const selected = selectedDateKeys.has(dateKey);
        const paused = pausedDateKeys.has(dateKey);
        return `
          <button
            class="dc-pause-date ${delivered ? "delivered" : ""} ${paused ? "paused" : ""} ${selected ? "selected slot-selected" : ""}"
            type="button"
            data-dc-slot-date="${dateKey}"
            ${delivered ? "disabled" : ""}
          >
            <small>${date.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
            <strong>${date.getDate()}</strong>
            ${renderDeliveryCalendarMarks(dateKey, delivered, controlDates)}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderDeliveryAddressCalendar() {
  const calendar = document.getElementById('dcAddressCalendar');
  if (!calendar || !activeDeliveryProduct) return;

  const isOpen = deliveryCalendarOpen.dcAddressMode;
  calendar.classList.toggle('open', isOpen);

  const dates = getDeliveryPlanDates(activeDeliveryProduct);
  if (dates.length === 0) {
    calendar.innerHTML = `<p class="dc-pause-calendar-empty">Subscription dates not selected.</p>`;
    return;
  }

  const deliveredDateKeys = getDeliveredDateKeys(activeDeliveryProduct);
  const selectedDateKeys = new Set(getAddressDeliveryDates());
  const pausedDateKeys = new Set(getPauseDeliveryDates());
  const controlDates = getDeliveryCalendarControlDates();

  calendar.innerHTML = `
    <div class="dc-pause-calendar-head">
      <strong>${activeDeliveryProduct.plan || "Plan"} Calendar</strong>
      <span>${formatControlDate(activeDeliveryProduct.start)} - ${formatControlDate(activeDeliveryProduct.end)}</span>
    </div>
    <div class="dc-pause-calendar-grid">
      ${dates.map(date => {
        const dateKey = getIsoLocalDate(date);
        const delivered = deliveredDateKeys.has(dateKey);
        const selected = selectedDateKeys.has(dateKey);
        const paused = pausedDateKeys.has(dateKey);
        return `
          <button
            class="dc-pause-date ${delivered ? "delivered" : ""} ${paused ? "paused" : ""} ${selected ? "selected address-selected" : ""}"
            type="button"
            data-dc-address-date="${dateKey}"
            ${delivered ? "disabled" : ""}
          >
            <small>${date.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
            <strong>${date.getDate()}</strong>
            ${renderDeliveryCalendarMarks(dateKey, delivered, controlDates)}
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function togglePauseDateSelection(dateKey) {
  if (!dateKey) return;

  const selected = new Set(selectedDeliveryPauseDates);
  if (getPauseDeliveryDates().includes(dateKey)) {
    selected.delete(dateKey);
    removePauseFromDate(dateKey);
    setDeliveryControlRemoved("pause", dateKey, true);
  } else {
    selected.add(dateKey);
    removedDeliveryPauseDates = removedDeliveryPauseDates
      .filter(date => date !== dateKey);
    setDeliveryControlRemoved("pause", dateKey, false);
  }

  setSelectedPauseDates([...selected]);
  const dateMode = document.querySelector('input[name="dcPauseMode"][value="date"]');
  if (dateMode) dateMode.checked = true;
  deliveryCalendarOpen.dcPauseMode = true;
  markDeliveryControlsDirty();
  renderAllDeliveryControlCalendars();
  updateDeliveryControlSummary();
}

function toggleSwitchDateSelection(dateKey) {
  if (!dateKey) return;

  const selected = new Set(selectedDeliverySwitchDates);
  if (selected.has(dateKey)) {
    selected.delete(dateKey);
    setDeliveryControlRemoved("switch_product", dateKey, true);
  } else {
    selected.add(dateKey);
    setDeliveryControlRemoved("switch_product", dateKey, false);
    removePauseFromDate(dateKey);
  }

  setSelectedSwitchDates([...selected]);
  const dateMode = document.querySelector('input[name="dcSwitchMode"][value="date"]');
  if (dateMode) dateMode.checked = true;
  deliveryCalendarOpen.dcSwitchMode = true;
  markDeliveryControlsDirty();
  renderAllDeliveryControlCalendars();
  updateDeliveryControlSummary();
}

function toggleQuantityDateSelection(dateKey) {
  if (!dateKey) return;

  const selected = new Set(selectedDeliveryQuantityDates);
  if (selected.has(dateKey)) {
    selected.delete(dateKey);
    setDeliveryControlRemoved("quantity", dateKey, true);
  } else {
    selected.add(dateKey);
    setDeliveryControlRemoved("quantity", dateKey, false);
    removePauseFromDate(dateKey);
  }

  setSelectedQuantityDates([...selected]);
  const dateMode = document.querySelector('input[name="dcQuantityMode"][value="date"]');
  if (dateMode) dateMode.checked = true;
  deliveryCalendarOpen.dcQuantityMode = true;
  markDeliveryControlsDirty();
  renderAllDeliveryControlCalendars();
  updateDeliveryControlSummary();
}

function toggleSlotDateSelection(dateKey) {
  if (!dateKey) return;

  const selected = new Set(selectedDeliverySlotDates);
  if (selected.has(dateKey)) {
    selected.delete(dateKey);
    setDeliveryControlRemoved("slot", dateKey, true);
  } else {
    selected.add(dateKey);
    setDeliveryControlRemoved("slot", dateKey, false);
    removePauseFromDate(dateKey);
  }

  setSelectedSlotDates([...selected]);
  const dateMode = document.querySelector('input[name="dcSlotMode"][value="date"]');
  if (dateMode) dateMode.checked = true;
  deliveryCalendarOpen.dcSlotMode = true;
  markDeliveryControlsDirty();
  renderAllDeliveryControlCalendars();
  updateDeliveryControlSummary();
}

function toggleAddressDateSelection(dateKey) {
  if (!dateKey) return;

  const selected = new Set(selectedDeliveryAddressDates);
  if (selected.has(dateKey)) {
    selected.delete(dateKey);
    setDeliveryControlRemoved("address", dateKey, true);
  } else {
    selected.add(dateKey);
    setDeliveryControlRemoved("address", dateKey, false);
    removePauseFromDate(dateKey);
  }

  setSelectedAddressDates([...selected]);
  const dateMode = document.querySelector('input[name="dcAddressMode"][value="date"]');
  if (dateMode) dateMode.checked = true;
  deliveryCalendarOpen.dcAddressMode = true;
  markDeliveryControlsDirty();
  renderAllDeliveryControlCalendars();
  updateDeliveryControlSummary();
}

function selectedProductLabel(mode) {
  if (mode === "tomorrow") {
    return document.getElementById('dcSwitchProductTomorrow')?.value || "";
  }
  if (mode === "date") {
    return document.getElementById('dcSwitchProductDate')?.value || "";
  }
  return "";
}

function getDeliveryControlSummaryBlocks(controls = []) {
  return normalizeDeliveryControls(controls).map(control => {
    if (control.type === "pause") {
      return `
        <p>
          <span>Pause Delivery</span>
          <strong class="dc-paused-date">${formatControlDate(control.effectiveDate)}</strong>
        </p>
      `;
    }

    if (control.type === "switch_product") {
      return `
        <p>
          <span>Switch Product</span>
          <strong>${control.value?.productName || "Product"} from ${formatControlDate(control.effectiveDate)}</strong>
        </p>
      `;
    }

    if (control.type === "quantity") {
      return `
        <p>
          <span>Changed Quantity</span>
          <strong>${control.value?.packets || 1} packet(s) on ${formatControlDate(control.effectiveDate)}</strong>
        </p>
      `;
    }

    if (control.type === "slot") {
      return `
        <p>
          <span>Changed Slot</span>
          <strong>${control.value?.slot || "-"} from ${formatControlDate(control.effectiveDate)}</strong>
        </p>
      `;
    }

    if (control.type === "address") {
      return `
        <p>
          <span>Changed Address</span>
          <strong>${control.value?.addressText || "Saved address"} from ${formatControlDate(control.effectiveDate)}</strong>
        </p>
      `;
    }

    return "";
  }).filter(Boolean);
}

function updateDeliverySaveButton() {
  const saveButton = document.getElementById('dcSaveChangesBtn');
  if (!saveButton) return;

  saveButton.disabled = !(activeDeliveryProduct && deliveryControlsDirty);
}

function matchesExistingDeliveryControl(type, date, value) {
  return getActiveDeliveryControls(activeDeliveryProduct).some(control =>
    control.type === type &&
    control.effectiveDate === date &&
    JSON.stringify(control.value) === JSON.stringify(value)
  );
}

function updateDeliveryControlSummary() {
  const changes = document.getElementById('dcSummaryChanges');
  if (!changes || !activeDeliveryProduct) {
    updateDeliverySaveButton();
    return;
  }

  const pauseDates = getPauseDeliveryDates();
  const existingPauseDates = new Set(
    getActiveDeliveryControls(activeDeliveryProduct)
      .filter(control => control.type === "pause" && control.value !== false)
      .map(control => control.effectiveDate)
  );
  const newPauseDates = pauseDates.filter(date => !existingPauseDates.has(date));

  const switchModes = getCheckedControlValues('dcSwitchMode');
  const switchDates = getSwitchDeliveryDates();

  const quantityModes = getCheckedControlValues('dcQuantityMode');
  const quantityDates = getQuantityDeliveryDates();

  const slotModes = getCheckedControlValues('dcSlotMode');
  const slotDates = getSlotDeliveryDates();
  const slotTomorrow = document.getElementById('dcSlotTomorrow')?.value;
  const slotDateValue = document.getElementById('dcSlotDateValue')?.value;

  const addressDates = getAddressDeliveryDates();
  const addressText = document.getElementById('dcAddressSelect')?.selectedOptions?.[0]?.textContent.trim() || "";

  const blocks = [];

  if (newPauseDates.length) {
    blocks.push(`
      <p>
        <span>Pause Delivery</span>
        <strong class="dc-paused-date">${newPauseDates.map(formatControlDate).join(", ")}</strong>
      </p>
    `);
  }

  const switchTomorrowDate = switchDates.includes(getTomorrowControlDate())
    ? getTomorrowControlDate()
    : "";
  const switchTomorrowProduct = selectedProductLabel("tomorrow");
  if (
    switchModes.includes("tomorrow") &&
    switchTomorrowDate &&
    switchTomorrowProduct &&
    !matchesExistingDeliveryControl(
      "switch_product",
      switchTomorrowDate,
      { productName: switchTomorrowProduct }
    )
  ) {
    blocks.push(`
      <p>
        <span>Switch Product</span>
        <strong>${switchTomorrowProduct} from ${formatControlDate(switchTomorrowDate)}</strong>
      </p>
    `);
  }

  const switchDateProduct = selectedProductLabel("date");
  const selectedSwitchDates = selectedDeliverySwitchDates.filter(date =>
    switchDates.includes(date) &&
    !matchesExistingDeliveryControl(
      "switch_product",
      date,
      { productName: switchDateProduct }
    )
  );
  if (selectedSwitchDates.length && switchDateProduct) {
    blocks.push(`
      <p>
        <span>Switch Product</span>
        <strong>${switchDateProduct} from ${selectedSwitchDates.map(formatControlDate).join(", ")}</strong>
      </p>
    `);
  }

  const quantityTomorrowDate = quantityDates.includes(getTomorrowControlDate())
    ? getTomorrowControlDate()
    : "";
  const quantityTomorrowPackets = document.getElementById('dcQuantityTomorrow')?.value;
  if (
    quantityModes.includes("tomorrow") &&
    quantityTomorrowDate &&
    quantityTomorrowPackets &&
    !matchesExistingDeliveryControl(
      "quantity",
      quantityTomorrowDate,
      { packets: Number(quantityTomorrowPackets) || 1 }
    )
  ) {
    blocks.push(`
      <p>
        <span>Changed Quantity</span>
        <strong>${quantityTomorrowPackets} packet${Number(quantityTomorrowPackets) === 1 ? "" : "s"} on ${formatControlDate(quantityTomorrowDate)}</strong>
      </p>
    `);
  }

  const quantityDatePackets = document.getElementById('dcQuantityDateValue')?.value;
  const selectedQuantityDates = selectedDeliveryQuantityDates.filter(date =>
    quantityDates.includes(date) &&
    !matchesExistingDeliveryControl(
      "quantity",
      date,
      { packets: Number(quantityDatePackets) || 1 }
    )
  );
  if (selectedQuantityDates.length && quantityDatePackets) {
    blocks.push(`
      <p>
        <span>Changed Quantity</span>
        <strong>${quantityDatePackets} packet${Number(quantityDatePackets) === 1 ? "" : "s"} on ${selectedQuantityDates.map(formatControlDate).join(", ")}</strong>
      </p>
    `);
  }

  const summaryPackets = quantityDatePackets && selectedQuantityDates.length
    ? quantityDatePackets
    : quantityTomorrowPackets && quantityModes.includes("tomorrow")
      ? quantityTomorrowPackets
      : activeDeliveryProduct.packets;
  document.getElementById('dcSummaryPackets').textContent = summaryPackets;

  const slotTomorrowDate = slotDates.includes(getTomorrowControlDate())
    ? getTomorrowControlDate()
    : "";
  if (
    slotModes.includes("tomorrow") &&
    slotTomorrowDate &&
    slotTomorrow &&
    !matchesExistingDeliveryControl(
      "slot",
      slotTomorrowDate,
      { slot: slotTomorrow }
    )
  ) {
    blocks.push(`
      <p>
        <span>Changed Slot</span>
        <strong>${slotTomorrow} from ${formatControlDate(slotTomorrowDate)}</strong>
      </p>
    `);
    document.getElementById('dcSummarySlot').textContent = slotTomorrow;
  } else if (selectedDeliverySlotDates.length && slotDateValue) {
    document.getElementById('dcSummarySlot').textContent = slotDateValue;
  } else {
    document.getElementById('dcSummarySlot').textContent = activeDeliveryProduct.slot;
  }

  const selectedSlotDates = selectedDeliverySlotDates.filter(date =>
    slotDates.includes(date) &&
    !matchesExistingDeliveryControl(
      "slot",
      date,
      { slot: slotDateValue }
    )
  );
  if (selectedSlotDates.length && slotDateValue) {
    blocks.push(`
      <p>
        <span>Changed Slot</span>
        <strong>${slotDateValue} from ${selectedSlotDates.map(formatControlDate).join(", ")}</strong>
      </p>
    `);
  }

  const addressId = document.getElementById('dcAddressSelect')?.value || "";
  const changedAddressDates = addressDates.filter(date =>
    !matchesExistingDeliveryControl(
      "address",
      date,
      { addressId, addressText }
    )
  );
  if (changedAddressDates.length && addressText) {
    blocks.push(`
      <p>
        <span>Changed Address</span>
        <strong>${addressText} from ${changedAddressDates.map(formatControlDate).join(", ")}</strong>
      </p>
    `);
  }

  const existingBlocks = getDeliveryControlSummaryBlocks(
    getActiveDeliveryControls(activeDeliveryProduct).filter(control =>
      !removedDeliveryControlKeys.includes(
        getDeliveryControlKey(control.type, control.effectiveDate)
      ) &&
      !(
        control.type === "pause" &&
        removedDeliveryPauseDates.includes(control.effectiveDate)
      )
    )
  );
  const summaryBlocks = [...existingBlocks, ...blocks];

  changes.innerHTML = summaryBlocks.length
    ? summaryBlocks.join("")
    : `<p><span>Controls</span><strong>No delivery changes selected yet.</strong></p>`;

  updateDeliverySaveButton();
}

function getActiveDeliveryOrderItem() {
  const order = getPlacedOrders().find(order =>
    String(order.id) === String(activeDeliveryProduct?.orderId)
  );
  return order?.items?.[Number(activeDeliveryProduct?.itemIndex)] || null;
}

function getDeliveryControlDailyCost(item, dateValue) {
  const date = parseDeliveryDate(dateValue) || getStartOfDay(new Date(dateValue));
  if (!item || isDeliveryPausedOnDate(item, date)) return 0;
  return getCartItemDailyTotal(applyDeliveryControlsToProduct(item, date));
}

function getDeliveryControlWalletAdjustments(
  item,
  newControls,
  mergedControls,
  extraAdjustmentDates = []
) {
  const priceAffectingTypes = new Set(["pause", "switch_product", "quantity"]);
  const adjustmentDates = [...new Set(
    [
      ...normalizeDeliveryControls(newControls)
      .filter(control => priceAffectingTypes.has(control.type))
      .map(control => control.effectiveDate)
      .filter(Boolean),
      ...extraAdjustmentDates
    ]
  )];

  const beforeItem = {
    ...item,
    deliveryControls: getActiveDeliveryControls(item)
  };
  const afterItem = {
    ...item,
    deliveryControls: mergedControls
  };

  return adjustmentDates
    .map(date => {
      const beforeCost = getDeliveryControlDailyCost(beforeItem, date);
      const afterCost = getDeliveryControlDailyCost(afterItem, date);
      const amount = beforeCost - afterCost;
      return {
        date,
        amount,
        beforeCost,
        afterCost
      };
    })
    .filter(adjustment => adjustment.amount !== 0);
}

function ensureMilkCashCanCoverAdjustments(adjustments = []) {
  const credits = adjustments
    .filter(adjustment => adjustment.amount > 0)
    .reduce((sum, adjustment) => sum + adjustment.amount, 0);
  const debits = adjustments
    .filter(adjustment => adjustment.amount < 0)
    .reduce((sum, adjustment) => sum + Math.abs(adjustment.amount), 0);

  if (debits <= getMilkCashBalance() + credits) return true;

  const shortfall = debits - getMilkCashBalance() - credits;
  showToast(`Add ${formatPaymentCurrency(shortfall)} to wallet before this change`);
  return false;
}

function saveMilkCashAdjustments(item, adjustments = []) {
  adjustments.forEach(adjustment => {
    const amount = Number(adjustment.amount) || 0;
    addMilkCashTransaction({
      amount,
      title: amount > 0 ? "Subscription Credit" : "Subscription Debit",
      note: `${item.name || "Product"} on ${formatControlDate(adjustment.date)}: ${formatPaymentCurrency(adjustment.beforeCost)} to ${formatPaymentCurrency(adjustment.afterCost)}`,
      orderId: activeDeliveryProduct?.orderId || "",
      itemIndex: activeDeliveryProduct?.itemIndex,
      effectiveDate: adjustment.date
    });
  });
}

function saveDeliveryControlChanges() {
  if (!activeDeliveryProduct) return;

  const newControls = collectDeliveryControlChanges();
  if (!deliveryControlsDirty) {
    showToast("Select a delivery control first");
    return;
  }

  const removedPauseDateKeys = new Set(removedDeliveryPauseDates);
  const removedControlKeys = new Set(removedDeliveryControlKeys);
  const newControlKeys = new Set(newControls.map(control =>
    getDeliveryControlKey(control.type, control.effectiveDate)
  ));
  const keepControl = control =>
    !removedControlKeys.has(
      getDeliveryControlKey(control.type, control.effectiveDate)
    ) &&
    !newControlKeys.has(
      getDeliveryControlKey(control.type, control.effectiveDate)
    ) &&
    !(
      control.type === "pause" &&
      removedPauseDateKeys.has(control.effectiveDate)
    );
  let savedToOrder = false;
  const orders = getPlacedOrders().map(order => {
    if (String(order.id) !== String(activeDeliveryProduct.orderId)) return order;

    const items = (order.items || []).map((item, itemIndex) => {
      if (itemIndex !== Number(activeDeliveryProduct.itemIndex)) return item;

      savedToOrder = true;
      return {
        ...item,
        deliveryControls: [
          ...getActiveDeliveryControls(item).filter(keepControl),
          ...newControls
        ]
      };
    });

    return { ...order, items };
  });

  const mergedControls = [
    ...getActiveDeliveryControls(activeDeliveryProduct).filter(keepControl),
    ...newControls
  ];
  const deliveryControlsSummary = getDeliveryControlsSummaryText(mergedControls);
  const sourceItem = getActiveDeliveryOrderItem() || activeDeliveryProduct;
  const removedPriceDates = removedDeliveryControlKeys
    .map(key => {
      const [type, date] = key.split("|");
      return ["pause", "switch_product", "quantity"].includes(type)
        ? date
        : "";
    })
    .filter(Boolean);
  const walletAdjustments = getDeliveryControlWalletAdjustments(
    sourceItem,
    newControls,
    mergedControls,
    [...removedDeliveryPauseDates, ...removedPriceDates]
  );

  if (!ensureMilkCashCanCoverAdjustments(walletAdjustments)) return;

  if (savedToOrder) {
    setPlacedOrders(orders.map(order => {
      if (String(order.id) !== String(activeDeliveryProduct.orderId)) return order;

      return {
        ...order,
        items: (order.items || []).map((item, itemIndex) =>
          itemIndex === Number(activeDeliveryProduct.itemIndex)
            ? {
                ...item,
                deliveryControls: mergedControls,
                deliveryControlsSummary
              }
            : item
        )
      };
    }));
    activeDeliveryProduct.deliveryControlsSummary = deliveryControlsSummary;
  }

  activeDeliveryProduct.deliveryControls = mergedControls;
  activeDeliveryProduct.deliveryControlsSummary = deliveryControlsSummary;
  removedDeliveryPauseDates = [];
  removedDeliveryControlKeys = [];
  deliveryControlsDirty = false;

  const saved =
    JSON.parse(localStorage.getItem('deliveryControlsByProduct')) || {};

  saved[activeDeliveryProduct.key] = {
    product: activeDeliveryProduct,
    savedAt: new Date().toISOString(),
    controls: mergedControls,
    adminSummary: deliveryControlsSummary,
    summary: document.getElementById('dcSummaryChanges')?.innerText || ""
  };

  localStorage.setItem('deliveryControlsByProduct', JSON.stringify(saved));
  saveMilkCashAdjustments(sourceItem, walletAdjustments);

  document.querySelectorAll(
    '#delivery-controls-screen input[name^="dc"][type="checkbox"]'
  ).forEach(input => {
    input.checked = false;
  });
  setSelectedPauseDates([]);
  setSelectedSwitchDates([]);
  setSelectedQuantityDates([]);
  setSelectedSlotDates([]);
  setSelectedAddressDates([]);
  deliveryCalendarOpen = {
    dcPauseMode: false,
    dcSwitchMode: false,
    dcQuantityMode: false,
    dcSlotMode: false,
    dcAddressMode: false
  };

  renderDailyDeliveryCard();
  renderProfileSubscriptions();
  renderProfileOrders();
  renderAllDeliveryControlCalendars();
  updateDeliveryControlSummary();
  showToast("Changes saved successfully");
  window.setTimeout(() => {
    setActiveScreen("home");
  }, 1000);
}

/* ================= NOTIFICATIONS =================
   Cart/wishlist/viewed product/subscription reminders banane aur dismiss karne ka logic.
*/
function getDismissedNotifications() {
  return JSON.parse(localStorage.getItem('dismissedNotifications')) || [];
}

function setDismissedNotifications(ids) {
  localStorage.setItem('dismissedNotifications', JSON.stringify(ids));
}

function rememberViewedProduct(product) {
  if (!product?.name) return;

  let viewed = JSON.parse(localStorage.getItem('viewedProducts')) || [];
  viewed = viewed.filter(item => item.name !== product.name);
  viewed.unshift({
    name: product.name,
    price: product.price,
    image: product.image,
    viewedAt: new Date().toISOString()
  });
  localStorage.setItem('viewedProducts', JSON.stringify(viewed.slice(0, 20)));
  updateNotificationBadge();
}

function getAppNotifications() {
  const dismissed = new Set(getDismissedNotifications());
  const wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];
  const cart = JSON.parse(localStorage.getItem('cart')) || [];
  const viewed = JSON.parse(localStorage.getItem('viewedProducts')) || [];
  const subscribed = JSON.parse(localStorage.getItem('subscribedProducts')) || [];
  const notifications = [];

  const inCart = name => cart.some(item => item.name === name);
  const inWishlist = name => wishlist.some(item => item.name === name);
  const isSubscribed = name => subscribed.some(item => item.name === name);

  productCatalog.forEach(item => {
    const id = `stock:${item.name}`;
    if (!dismissed.has(id) && !item.isAvailable) {
      notifications.push({
        id,
        type: 'stock',
        title: item.name,
        message: item.availabilityMessage || 'This product is currently out of stock.',
        image: item.imageUrl
      });
    }
  });

  viewed.forEach(item => {
    const id = `view:${item.name}`;
    if (!dismissed.has(id) && !inWishlist(item.name) && !inCart(item.name) && !isSubscribed(item.name)) {
      notifications.push({
        id,
        type: 'view',
        title: item.name,
        message: 'You viewed this product. Subscribe or add it before it slips away.',
        image: normalizeAssetPath(item.image)
      });
    }
  });

  wishlist.forEach(item => {
    const id = `wishlist:${item.name}`;
    if (!dismissed.has(id) && !inCart(item.name) && !isSubscribed(item.name)) {
      notifications.push({
        id,
        type: 'wishlist',
        title: item.name,
        message: 'This wishlist product is waiting. Add it to cart when you are ready.',
        image: normalizeAssetPath(item.image)
      });
    }
  });

  cart.forEach(item => {
    const id = `cart:${item.name}:${item.quantity}:${item.plan}:${item.slot}`;
    if (!dismissed.has(id) && !isSubscribed(item.name)) {
      notifications.push({
        id,
        type: 'cart',
        title: item.name,
        message: 'This product is in your cart. Complete checkout to start delivery.',
        image: normalizeAssetPath(item.image)
      });
    }
  });

  return notifications;
}

function updateNotificationBadge() {
  const badge = document.getElementById('notification-count');
  if (badge) badge.textContent = getAppNotifications().length;
}

function renderNotifications() {
  const list = document.getElementById('notificationsList');
  if (!list) return;

  const notifications = getAppNotifications();
  updateNotificationBadge();

  if (notifications.length === 0) {
    list.innerHTML = '<div class="notifications-empty">No notifications right now.</div>';
    return;
  }

  list.innerHTML = notifications.map(note => `
    <article class="notification-card" data-notification-id="${note.id}" data-notification-type="${note.type}" data-notification-title="${note.title}">
      <img src="${note.image}" alt="">
      <div>
        <h3>${note.title}</h3>
        <p>${note.message}</p>
      </div>
      <button type="button" class="notification-remove" data-remove-notification="${note.id}">✕</button>
    </article>
  `).join("");
}

function openNotificationTarget(noteCard) {
  const type = noteCard.dataset.notificationType;
  const title = noteCard.dataset.notificationTitle;

  if (type === 'cart') {
    setActiveScreen('orders');
    return;
  }

  if (type === 'wishlist') {
    setActiveScreen('wishlist');
    return;
  }

  const productCard = Array
    .from(document.querySelectorAll('#products-screen .product-card'))
    .find(card => card.querySelector('h3')?.textContent.trim() === title);

  if (productCard) {
    editingCartIndex = null;
    openProductDetailFromCard(productCard);
  } else {
    showAllProductsFilter();
  }
}

function clearDcAddressForm() {
  [
    'dcAddressName',
    'dcAddressMobile',
    'dcAddressHouse',
    'dcAddressStreet',
    'dcAddressTown'
  ].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });
  clearAddressMapVerification('dcAddress');
  updateAddressMapNote('dcAddress');
}

function closeDcAddressForm() {
  document.getElementById('dcAddressForm')?.classList.remove('active');
  clearDcAddressForm();
}

function saveDcAddress() {
  const name = document.getElementById('dcAddressName')?.value.trim();
  const mobile = document.getElementById('dcAddressMobile')?.value.trim();
  const house = document.getElementById('dcAddressHouse')?.value.trim();
  const street = document.getElementById('dcAddressStreet')?.value.trim();
  const town = document.getElementById('dcAddressTown')?.value.trim();

  if (!name || !mobile || !house || !street || !town) {
    alert("Please fill all required address details");
    return;
  }

  const id = Date.now();
  const addresses = getSavedAddresses();
  addresses.push({
    id,
    name,
    mobile,
    pin: '333031',
    house,
    street,
    town,
    city: 'Pilani',
    state: 'Rajasthan'
  });

  setSavedAddresses(addresses);
  localStorage.setItem('selectedDeliveryAddressId', id);
  populateDeliveryControlSelects(activeDeliveryProduct || {});

  const addressSelect = document.getElementById('dcAddressSelect');
  if (addressSelect) addressSelect.value = String(id);

  closeDcAddressForm();
  updateDeliveryControlSummary();
  renderAddresses();
  renderProfileAddresses();
  renderCartAddressPage();
  showToast("Address added");
}

/* ================= SCREEN NAVIGATION =================
   Ye app ka central router hai.
   Har button jisme data-go-screen hai, woh is function ke through screen change karta hai.
   Screen open hote hi required render/load function bhi yahin call hota hai.
*/
function setActiveScreen(screenName, options = {}) {
      const activeScreenName = getActiveScreenName();
      const isSameScreen = activeScreenName === screenName;

      if (
        activeScreenName &&
        !isSameScreen &&
        !options.fromBack &&
        !options.replace
      ) {
        screenHistory.push(activeScreenName);
        screenHistory = screenHistory.slice(-30);
      }

      if (!isSameScreen && !options.skipBrowserHistory && !isBrowserHistoryNavigation) {
        syncBrowserHistoryForScreen(screenName, { replace: Boolean(options.replace) });
      }

      document
        .querySelector('.mobile-app')
        ?.classList.toggle('wide-cart-layout', false);

      if (screenName === 'orders') loadOrders();
      if (screenName === 'wallet') renderWallet();
      if (screenName === 'walletTransactions') renderWalletTransactions();
      if (screenName === 'addmoney') {
        setActiveScreen('wallet', { replace: true });
        return;
      }
      if (screenName === 'cartAddress') renderCartAddressPage();
      if (screenName === 'profileOrders') renderProfileOrders();
      if (screenName === 'profileSubscriptions') renderProfileSubscriptions();
      if (screenName === 'profileAddresses') renderProfileAddresses();
      if (screenName === 'profileCards') renderProfileCards();
      if (screenName === 'profileUpi') renderProfileUpis();
      if (screenName === 'notifications') renderNotifications();
      if (screenName === 'paymentMode') loadPaymentMode();
      if (screenName === 'upiQr') loadUpiQrScreen();
      if (screenName !== 'upiQr') stopUpiQrTimer();
      if (screenName === 'otp') {
  setTimeout(() => {
    setupOtpBoxes();
    resetOtpBoxes();
    updateOtpResendTimerDisplay();
    document.querySelector(".otp-box")?.focus();
  }, 50);
}
      if (screenName === 'checkout') {
  loadCheckout();
}

      if (screenName === 'wishlist') {
  loadWishlist();
}

      if (screenName === 'home') {
  renderDailyDeliveryCard();
}

    screens.forEach(screen =>
      screen.classList.toggle('active', screen.dataset.screen === screenName)
  );

  appShell?.classList.remove('appbar-scrolling');

  bottomNavItems.forEach(item =>
    item.classList.toggle('active', item.dataset.goScreen === screenName)
  );

  // 🔥 ADD THIS BLOCK
  if (screenName === 'productDetail') {
    const planBox = document.getElementById('planBox');

    if (planBox) {
      planBox.classList.add('glow-effect');

      setTimeout(() => {
        planBox.classList.remove('glow-effect');
      }, 3000); // 3 seconds
    }
  }
}
    
    initAppBrowserHistory();

    navTriggers.forEach((trigger) => {
  trigger.addEventListener('click', () => {

    const target = trigger.dataset.goScreen;
    const category = trigger.dataset.category;

    // 🔥 LOGIN CHECK
    const protectedScreens = ["wallet", "walletTransactions", "profile", "orders", "profileOrders", "profileSubscriptions", "profileAddresses", "profileCards", "profileUpi", "notifications"];

    if (protectedScreens.includes(target) && !isLoggedIn) {
      setActiveScreen("login");
      return;
    }
    if (target === "profile") {
      loadProfileData(); // 🔥 ADD THIS
    }
    if (target === "wishlist") {
   previousScreen = document
      .querySelector('.screen.active')
      ?.dataset.screen || "home";
}

    if (target) {
      setActiveScreen(target);


      if (category) {
        filterButtons.forEach(btn => btn.classList.remove('active'));

        const selectedBtn = document.querySelector(`[data-filter="${category}"]`);
        if (selectedBtn) {
  selectedBtn.classList.add('active');

  // 🔥 AUTO SCROLL FIX
  selectedBtn.scrollIntoView({
    behavior: "smooth",
    inline: "center"
  });
}

        productSections.forEach(section => {
          section.style.display =
            section.dataset.section === category ? 'block' : 'none';
        });
      }
    }
  });
});

    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const selected = button.dataset.filter;
        filterButtons.forEach((item) => item.classList.remove('active'));
        button.classList.add('active');

        button.scrollIntoView({
          behavior: "smooth",
          inline: "center"
        }); 

        productSections.forEach((section) => {
          section.style.display = selected === 'all' || section.dataset.section === selected ? 'block' : 'none';
        });
      });
    });

    function updatePlanSelection(selectedCard) {
  planCards.forEach((card, index) => {
    const isActive = card === selectedCard;
    card.classList.toggle('selected', isActive);
    radioPills[index]?.classList.toggle('selected', isActive);
  });
}

    planCards.forEach((card) => {
      card.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        updatePlanSelection(card);
      });
    });

    radioPills.forEach((pill, index) => {
      pill.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        updatePlanSelection(planCards[index]);
      });
    });

    dayPills.forEach((pill) => {
      pill.addEventListener('click', (event) => {
        event.preventDefault();
        pill.classList.toggle('active');
      });
    });

    plusBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      quantity += 1;
      quantityDisplay.textContent = quantity;
    });

    minusBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      if (quantity > 1) {
        quantity -= 1;
        quantityDisplay.textContent = quantity;
      }
    });

/* ================= AUTH AND PROFILE HELPERS =================
   Mobile/email normalize, Supabase client access, profile cache, OTP login/register helpers.
*/
function mrNormalizeMobile(value) {
  return String(value || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").replace(/^0+/, "");
}

function mrNormalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function mrIsValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mrNormalizeEmail(value));
}

function mrIsValidMobile(value) {
  return mrNormalizeMobile(value).length === 10;
}

function mrGetSupabase() {
  if (!window.supabaseClient) {
    alert("Supabase connection not loaded. Please check Supabase.js.");
    return null;
  }

  return window.supabaseClient;
}

function mrCacheProfile(profile) {
  if (!profile) return;

  localStorage.setItem("userName", profile.name || "");
  localStorage.setItem("userMobile", mrNormalizeMobile(profile.mobile));
  localStorage.setItem("userEmail", mrNormalizeEmail(profile.email));
  localStorage.setItem("currentUserKey", mrNormalizeEmail(profile.email) || mrNormalizeMobile(profile.mobile));
  localStorage.setItem("isLoggedIn", "true");
  isLoggedIn = true;
}

function mrReadCart() {
  try {
    return JSON.parse(localStorage.getItem("cart")) || [];
  } catch (error) {
    return [];
  }
}

function mrReadWishlist() {
  try {
    return JSON.parse(localStorage.getItem("wishlist")) || [];
  } catch (error) {
    return [];
  }
}

function mrReadPlacedOrders() {
  try {
    return JSON.parse(localStorage.getItem("placedOrders")) || [];
  } catch (error) {
    return [];
  }
}

const MR_ORDER_DETAILS_BACKUP_KEY = "placedOrdersDetailBackup";

function mrReadPlacedOrdersDetailBackup() {
  try {
    return JSON.parse(localStorage.getItem(MR_ORDER_DETAILS_BACKUP_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function mrOrderHasDetailItems(order) {
  return Array.isArray(order?.items) && order.items.length > 0;
}

function mrBackupPlacedOrderDetails(orders = []) {
  const detailedOrders = (orders || []).filter(mrOrderHasDetailItems);
  if (detailedOrders.length === 0) return;

  const backupById = new Map(
    mrReadPlacedOrdersDetailBackup().map(order => [String(order.id || ""), order])
  );

  detailedOrders.forEach(order => {
    if (!order?.id) return;
    backupById.set(String(order.id), order);
  });

  localStorage.setItem(
    MR_ORDER_DETAILS_BACKUP_KEY,
    JSON.stringify([...backupById.values()])
  );
}

function mrPreserveOrderDetails(orders = [], fallbackOrders = []) {
  const fallbackById = new Map(
    [
      ...mrReadPlacedOrdersDetailBackup(),
      ...(fallbackOrders || [])
    ]
      .filter(mrOrderHasDetailItems)
      .map(order => [String(order.id || ""), order])
  );

  return (orders || []).map(order => {
    const fallbackOrder = fallbackById.get(String(order?.id || ""));
    if (mrOrderHasDetailItems(order) || !fallbackOrder) return order;

    return {
      ...fallbackOrder,
      ...order,
      items: fallbackOrder.items,
      totalAmount: Number(order?.totalAmount) || fallbackOrder.totalAmount,
      codFee: Number(order?.codFee) || fallbackOrder.codFee || 0
    };
  });
}

function mrReadSavedUpis() {
  try {
    return JSON.parse(localStorage.getItem("savedUpis")) || [];
  } catch (error) {
    return [];
  }
}

function mrReadSavedAddresses() {
  try {
    return JSON.parse(localStorage.getItem("addresses")) || [];
  } catch (error) {
    return [];
  }
}

function mrBuildCartItemKey(item) {
  return [
    item?.name,
    item?.quantity,
    item?.slot,
    item?.plan,
    item?.start,
    item?.end
  ]
    .map(value => String(value || "").trim().toLowerCase())
    .join("|");
}

function mrBuildWishlistItemKey(item) {
  return String(item?.name || "")
    .trim()
    .toLowerCase();
}

function mrCartRowToItem(row) {
  return {
    name: row.product_name,
    price: Number(row.price) || 0,
    image: normalizeAssetPath(row.image_url),
    quantity: row.quantity || "",
    packets: Number(row.packets) || 1,
    start: row.start_date || "",
    end: row.end_date || "",
    slot: row.slot || "",
    plan: row.plan || ""
  };
}

function mrWishlistRowToItem(row) {
  return {
    name: row.product_name,
    price: row.price || "",
    image: normalizeAssetPath(row.image_url),
    category: row.category || ""
  };
}

function mrNormalizeWishlistItems(wishlist = []) {
  const uniqueItems = new Map();

  (wishlist || []).forEach(item => {
    const key = mrBuildWishlistItemKey(item);
    if (!key) return;
    uniqueItems.set(key, {
      ...item,
      image: normalizeAssetPath(item?.image)
    });
  });

  return [...uniqueItems.values()];
}

async function mrGetCurrentAuthUserId() {
  const sb = mrGetSupabase();
  if (!sb) return null;

  const { data, error } = await sb.auth.getUser();
  if (error) {
    console.log(error);
    return null;
  }

  return data?.user?.id || null;
}

/* ================= SUPABASE USER DATA SYNC =================
   Cart, wishlist, orders, saved UPI, saved addresses ko Supabase tables ke saath sync karta hai.
   mrSave* functions localStorage update karte hain aur queued sync start karte hain.
   mrHydrate* functions Supabase se latest data laake local UI refresh karte hain.
   Realtime channel same account ke updates doosre device par instantly hydrate karta hai.
*/
let mrCartSyncTimer = null;
let mrWishlistSyncTimer = null;
let mrOrdersSyncTimer = null;
let mrSavedUpisSyncTimer = null;
let mrSavedAddressesSyncTimer = null;
let mrRealtimeChannel = null;
let mrRealtimeUserId = null;
let mrRealtimeRefreshTimer = null;
let mrRealtimePendingAreas = new Set();

function mrSaveCart(cart, { sync = true } = {}) {
  localStorage.setItem("cart", JSON.stringify(cart || []));
  if (sync) mrQueueCartSync(cart || []);
}

function mrSaveWishlist(wishlist, { sync = true } = {}) {
  const cleanWishlist = mrNormalizeWishlistItems(wishlist || []);
  localStorage.setItem("wishlist", JSON.stringify(cleanWishlist));
  if (sync) mrQueueWishlistSync(cleanWishlist);
}

function mrSavePlacedOrders(orders, { sync = true } = {}) {
  const preservedOrders = mrPreserveOrderDetails(orders || [], mrReadPlacedOrders());
  localStorage.setItem("placedOrders", JSON.stringify(preservedOrders));
  mrBackupPlacedOrderDetails(preservedOrders);
  if (sync) mrQueueOrdersSync(preservedOrders);
}

function mrSaveSavedUpis(upis, { sync = true } = {}) {
  localStorage.setItem("savedUpis", JSON.stringify(upis || []));
  if (sync) mrQueueSavedUpisSync(upis || []);
}

function mrSaveSavedAddresses(addresses, { sync = true } = {}) {
  localStorage.setItem("addresses", JSON.stringify(addresses || []));
  if (sync) mrQueueSavedAddressesSync(addresses || []);
}

function mrRefreshCartViews() {
  loadSelectedCartItems();
  updateCartBadge();
  renderDailyDeliveryCard();
  updateNotificationBadge();

  const activeScreen = getActiveScreenName();
  if (activeScreen === "orders") loadOrders();
  if (activeScreen === "cartAddress") renderCartAddressPage();
  if (activeScreen === "paymentMode") loadPaymentMode();
}

function mrRefreshOrderViews() {
  renderDailyDeliveryCard();
  updateNotificationBadge();

  const activeScreen = getActiveScreenName();
  if (activeScreen === "profileOrders") renderProfileOrders();
  if (activeScreen === "profileSubscriptions") renderProfileSubscriptions();
  if (activeScreen === "notifications") renderNotifications();
}

function mrRefreshSavedUpiViews() {
  if (getActiveScreenName() === "profileUpi") renderProfileUpis();
}

function mrRefreshAddressViews() {
  renderAddresses();
  renderProfileAddresses();
  renderCartAddressPage();
  populateDeliveryControlSelects(activeDeliveryProduct || {});
}

function mrQueueCartSync(cart = mrReadCart()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  clearTimeout(mrCartSyncTimer);
  mrCartSyncTimer = setTimeout(() => {
    mrSyncCartToDatabase(cart);
  }, 150);
}

function mrQueueWishlistSync(wishlist = mrReadWishlist()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  clearTimeout(mrWishlistSyncTimer);
  mrWishlistSyncTimer = setTimeout(() => {
    mrSyncWishlistToDatabase(wishlist);
  }, 150);
}

function mrQueueOrdersSync(orders = mrReadPlacedOrders()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  clearTimeout(mrOrdersSyncTimer);
  mrOrdersSyncTimer = setTimeout(() => {
    mrSyncOrdersToDatabase(orders);
  }, 150);
}

function mrQueueSavedUpisSync(upis = mrReadSavedUpis()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  clearTimeout(mrSavedUpisSyncTimer);
  mrSavedUpisSyncTimer = setTimeout(() => {
    mrSyncSavedUpisToDatabase(upis);
  }, 150);
}

function mrQueueSavedAddressesSync(addresses = mrReadSavedAddresses()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  clearTimeout(mrSavedAddressesSyncTimer);
  mrSavedAddressesSyncTimer = setTimeout(() => {
    mrSyncSavedAddressesToDatabase(addresses);
  }, 150);
}

async function mrSyncCartToDatabase(cart = mrReadCart()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return false;

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return false;

  const rows = (cart || []).map((item, index) => ({
    user_id: userId,
    item_key: mrBuildCartItemKey(item) || `${Date.now()}-${index}`,
    product_name: String(item.name || ""),
    quantity: String(item.quantity || ""),
    packets: Number(item.packets) || 1,
    price: Number(item.price) || 0,
    image_url: normalizeAssetPath(item.image),
    start_date: item.start || null,
    end_date: item.end || null,
    slot: item.slot || "",
    plan: item.plan || ""
  }));

  const { error: deleteError } = await sb
    .from("cart_items")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    console.log(deleteError);
    return false;
  }

  if (rows.length === 0) return true;

  const { error: insertError } = await sb
    .from("cart_items")
    .insert(rows);

  if (insertError) {
    console.log(insertError);
    return false;
  }

  return true;
}

async function mrHydrateCartFromDatabase({ preferLocal = false, forceRemote = false } = {}) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  const localCart = mrReadCart();
  if (preferLocal && !forceRemote && localCart.length > 0) {
    mrQueueCartSync(localCart);
    return;
  }

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return;

  const { data, error } = await sb
    .from("cart_items")
    .select("product_name,quantity,packets,price,image_url,start_date,end_date,slot,plan,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.log(error);
    if (!forceRemote && localCart.length > 0) mrQueueCartSync(localCart);
    return;
  }

  if (Array.isArray(data) && data.length > 0) {
    mrSaveCart(data.map(mrCartRowToItem), { sync: false });
    loadSelectedCartItems();
    selectedCartItems = new Set([...selectedCartItems].filter(index => index < data.length));
    saveSelectedCartItems();
    mrRefreshCartViews();
    return;
  }

  if (forceRemote) {
    mrSaveCart([], { sync: false });
    selectedCartItems = new Set();
    saveSelectedCartItems();
    mrRefreshCartViews();
  } else if (localCart.length > 0) {
    mrQueueCartSync(localCart);
  }
}

async function mrSyncWishlistToDatabase(wishlist = mrReadWishlist()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return false;

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return false;

  const rows = mrNormalizeWishlistItems(wishlist || []).map((item, index) => ({
    user_id: userId,
    item_key: mrBuildWishlistItemKey(item) || `${Date.now()}-${index}`,
    product_name: String(item.name || ""),
    price: String(item.price || ""),
    image_url: normalizeAssetPath(item.image),
    category: item.category || ""
  }));

  const { error: deleteError } = await sb
    .from("wishlist_items")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    console.log(deleteError);
    return false;
  }

  if (rows.length === 0) return true;

  const { error: insertError } = await sb
    .from("wishlist_items")
    .insert(rows);

  if (insertError) {
    console.log(insertError);
    return false;
  }

  return true;
}

async function mrHydrateWishlistFromDatabase({ preferLocal = false, forceRemote = false } = {}) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  const localWishlist = mrReadWishlist();
  if (preferLocal && !forceRemote && localWishlist.length > 0) {
    mrQueueWishlistSync(localWishlist);
    return;
  }

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return;

  const { data, error } = await sb
    .from("wishlist_items")
    .select("product_name,price,image_url,category,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.log(error);
    if (!forceRemote && localWishlist.length > 0) mrQueueWishlistSync(localWishlist);
    return;
  }

  if (Array.isArray(data) && data.length > 0) {
    mrSaveWishlist(data.map(mrWishlistRowToItem), { sync: false });
  } else if (!forceRemote && localWishlist.length > 0) {
    mrQueueWishlistSync(localWishlist);
  } else {
    mrSaveWishlist([], { sync: false });
  }

  updateWishlistBadge();
  syncWishlistUI();
  updateNotificationBadge();
  if (getActiveScreenName() === "wishlist") loadWishlist();
}

function mrOrderRowToOrder(row) {
  return {
    id: row.id,
    orderedAt: row.ordered_at,
    paymentMode: row.payment_mode,
    status: row.status || "Confirmed",
    codFee: Number(row.cod_fee) || 0,
    totalAmount: Number(row.total_amount) || 0,
    items: (row.order_items || [])
      .sort((a, b) => Number(a.item_index) - Number(b.item_index))
      .map(item => ({
        name: item.product_name,
        price: Number(item.price) || 0,
        image: normalizeAssetPath(item.image_url),
        quantity: item.quantity || "",
        packets: Number(item.packets) || 1,
        start: item.start_date || "",
        end: item.end_date || "",
        slot: item.slot || "",
        plan: item.plan || "",
        cancelled: Boolean(item.cancelled),
        cancelledAt: item.cancelled_at || "",
        deliveryControls: normalizeDeliveryControls(item.delivery_controls || item.deliveryControls),
        deliveryControlsSummary: item.delivery_controls_summary || getDeliveryControlsSummaryText(item.delivery_controls || item.deliveryControls)
      }))
  };
}

async function mrSyncOrdersToDatabase(orders = mrReadPlacedOrders()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return false;

  orders = mrPreserveOrderDetails(orders || [], mrReadPlacedOrders());

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return false;

  const orderRows = (orders || []).map(order => ({
    id: String(order.id || `MR${Date.now()}`),
    user_id: userId,
    ordered_at: order.orderedAt || new Date().toISOString(),
    payment_mode: order.paymentMode || "Cash On Delivery",
    status: order.status || "Confirmed",
    cod_fee: Number(order.codFee ?? getOrderCodFee(order)) || 0,
    total_amount: calculateOrderPaidTotal(order),
    updated_at: new Date().toISOString()
  }));

  const orderItemRows = [];
  (orders || []).forEach(order => {
    (order.items || []).forEach((item, itemIndex) => {
      orderItemRows.push({
        order_id: String(order.id),
        user_id: userId,
        item_index: itemIndex,
        product_name: String(item.name || ""),
        price: getBasePrice(item.price),
        image_url: normalizeAssetPath(item.image),
        quantity: item.quantity || "",
        packets: Number(item.packets) || 1,
        start_date: item.start || null,
        end_date: item.end || null,
        slot: item.slot || "",
        plan: item.plan || "",
        cancelled: Boolean(item.cancelled),
        cancelled_at: item.cancelledAt || null,
        delivery_controls: normalizeDeliveryControls(item.deliveryControls),
        delivery_controls_summary: getDeliveryControlsSummaryText(item.deliveryControls),
        updated_at: new Date().toISOString()
      });
    });
  });

  if (orderRows.length > 0 && orderItemRows.length === 0) {
    console.log("Skipping order sync because order item details are missing.");
    return false;
  }

  const { error: deleteItemsError } = await sb
    .from("order_items")
    .delete()
    .eq("user_id", userId);

  if (deleteItemsError) {
    console.log(deleteItemsError);
    return false;
  }

  const { error: deleteOrdersError } = await sb
    .from("orders")
    .delete()
    .eq("user_id", userId);

  if (deleteOrdersError) {
    console.log(deleteOrdersError);
    return false;
  }

  if (orderRows.length === 0) return true;

  const { error: insertOrdersError } = await sb
    .from("orders")
    .insert(orderRows);

  if (insertOrdersError) {
    console.log(insertOrdersError);
    return false;
  }

  if (orderItemRows.length === 0) return true;

  const { error: insertItemsError } = await sb
    .from("order_items")
    .insert(orderItemRows);

  if (insertItemsError) {
    console.log(insertItemsError);
    return false;
  }

  return true;
}

async function mrHydrateOrdersFromDatabase({ preferLocal = false, forceRemote = false } = {}) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  const localOrders = mrReadPlacedOrders();
  if ((preferLocal || didUndoJune26Pause) && !forceRemote && localOrders.length > 0) {
    mrQueueOrdersSync(localOrders);
    return;
  }

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return;

  const { data, error } = await sb
    .from("orders")
    .select(`
      id,
      ordered_at,
      payment_mode,
      status,
      cod_fee,
      total_amount,
      order_items (
        item_index,
        product_name,
        price,
        image_url,
        quantity,
        packets,
        start_date,
        end_date,
        slot,
        plan,
        cancelled,
        cancelled_at,
        delivery_controls,
        delivery_controls_summary
      )
    `)
    .eq("user_id", userId)
    .order("ordered_at", { ascending: false });

  if (error) {
    console.log(error);
    if (!forceRemote && localOrders.length > 0) mrQueueOrdersSync(localOrders);
    return;
  }

  if (Array.isArray(data) && data.length > 0) {
    const remoteOrderRows = data.map(order => ({
      ...order,
      order_items: Array.isArray(order.order_items) ? order.order_items : []
    }));
    const orderIds = remoteOrderRows
      .map(order => order.id)
      .filter(Boolean);
    const hasRelatedItems = remoteOrderRows.some(order => order.order_items.length > 0);

    if (!hasRelatedItems && orderIds.length > 0) {
      const { data: itemData, error: itemError } = await sb
        .from("order_items")
        .select(`
          order_id,
          item_index,
          product_name,
          price,
          image_url,
          quantity,
          packets,
          start_date,
          end_date,
          slot,
          plan,
          cancelled,
          cancelled_at,
          delivery_controls,
          delivery_controls_summary
        `)
        .eq("user_id", userId)
        .in("order_id", orderIds)
        .order("item_index", { ascending: true });

      if (itemError) {
        console.log(itemError);
      } else {
        const itemsByOrderId = new Map();
        (itemData || []).forEach(item => {
          const orderItems = itemsByOrderId.get(item.order_id) || [];
          orderItems.push(item);
          itemsByOrderId.set(item.order_id, orderItems);
        });

        remoteOrderRows.forEach(order => {
          order.order_items = itemsByOrderId.get(order.id) || order.order_items;
        });
      }
    }

    const remoteOrders = remoteOrderRows.map(mrOrderRowToOrder);
    const mergedOrders = mrPreserveOrderDetails(remoteOrders, localOrders);
    const restoredMissingItems = remoteOrders.some((order, index) =>
      !mrOrderHasDetailItems(order) && mrOrderHasDetailItems(mergedOrders[index])
    );

    mrSavePlacedOrders(mergedOrders, { sync: false });
    if (restoredMissingItems) mrQueueOrdersSync(mergedOrders);
  } else if (!forceRemote && localOrders.length > 0) {
    mrQueueOrdersSync(localOrders);
  } else {
    mrSavePlacedOrders([], { sync: false });
  }

  mrRefreshOrderViews();
}

function mrSavedUpiKey(upi) {
  return String(upi?.upiId || "")
    .trim()
    .replace(/\s/g, "")
    .toLowerCase();
}

function mrNormalizeSavedUpis(upis = []) {
  const uniqueUpis = new Map();

  (upis || []).forEach((upi, index) => {
    const upiId = String(upi?.upiId || "").trim().replace(/\s/g, "");
    if (!/^[^\s@]+@[^\s@]+$/.test(upiId)) return;
    const key = upiId.toLowerCase();
    uniqueUpis.set(key, {
      id: Number(upi.id) || Date.now() + index,
      upiId,
      label: (upi.label || "UPI Account").trim() || "UPI Account"
    });
  });

  return [...uniqueUpis.values()];
}

function mrSavedUpiRowToItem(row) {
  return {
    id: Number(row.local_id) || Date.now(),
    upiId: row.upi_id || "",
    label: row.label || "UPI Account"
  };
}

async function mrSyncSavedUpisToDatabase(upis = mrReadSavedUpis()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return false;

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return false;

  const rows = mrNormalizeSavedUpis(upis).map((upi, index) => ({
    user_id: userId,
    local_id: Number(upi.id) || Date.now() + index,
    upi_key: mrSavedUpiKey(upi),
    upi_id: upi.upiId,
    label: upi.label || "UPI Account",
    updated_at: new Date().toISOString()
  }));

  const { error: deleteError } = await sb
    .from("saved_upis")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    console.log(deleteError);
    return false;
  }

  if (rows.length === 0) return true;

  const { error: insertError } = await sb
    .from("saved_upis")
    .insert(rows);

  if (insertError) {
    console.log(insertError);
    return false;
  }

  return true;
}

async function mrHydrateSavedUpisFromDatabase({ preferLocal = false, forceRemote = false } = {}) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  const localUpis = mrReadSavedUpis();
  if (preferLocal && !forceRemote && localUpis.length > 0) {
    mrQueueSavedUpisSync(localUpis);
    return;
  }

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return;

  const { data, error } = await sb
    .from("saved_upis")
    .select("local_id,upi_id,label,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.log(error);
    if (!forceRemote && localUpis.length > 0) mrQueueSavedUpisSync(localUpis);
    return;
  }

  if (Array.isArray(data) && data.length > 0) {
    mrSaveSavedUpis(data.map(mrSavedUpiRowToItem), { sync: false });
  } else if (!forceRemote && localUpis.length > 0) {
    mrQueueSavedUpisSync(localUpis);
  } else {
    mrSaveSavedUpis([], { sync: false });
  }

  mrRefreshSavedUpiViews();
}

function mrSavedAddressKey(address) {
  return [
    address?.mobile,
    address?.pin,
    address?.house,
    address?.street,
    address?.town,
    address?.city,
    address?.state
  ]
    .map(value => String(value || "").trim().toLowerCase())
    .join("|");
}

function mrNormalizeSavedAddresses(addresses = []) {
  const uniqueAddresses = new Map();

  (addresses || []).forEach((address, index) => {
    if (
      !address ||
      !address.name ||
      !address.mobile ||
      !address.house ||
      !address.street ||
      !address.town
    ) return;

    const cleanAddress = {
      id: Number(address.id) || Date.now() + index,
      name: String(address.name || "").trim(),
      mobile: String(address.mobile || "").trim(),
      pin: String(address.pin || "333031").trim(),
      house: String(address.house || "").trim(),
      street: String(address.street || "").trim(),
      town: String(address.town || "").trim(),
      city: String(address.city || "Pilani").trim(),
      state: String(address.state || "Rajasthan").trim()
    };
    const key = mrSavedAddressKey(cleanAddress);
    if (!key) return;
    uniqueAddresses.set(key, cleanAddress);
  });

  return [...uniqueAddresses.values()];
}

function mrSavedAddressRowToItem(row) {
  return {
    id: Number(row.local_id) || Date.now(),
    name: row.name || "",
    mobile: row.mobile || "",
    pin: row.pin || "333031",
    house: row.house || "",
    street: row.street || "",
    town: row.town || "",
    city: row.city || "Pilani",
    state: row.state || "Rajasthan"
  };
}

async function mrSyncSavedAddressesToDatabase(addresses = mrReadSavedAddresses()) {
  if (localStorage.getItem("isLoggedIn") !== "true") return false;

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return false;

  const rows = mrNormalizeSavedAddresses(addresses).map((address, index) => ({
    user_id: userId,
    local_id: Number(address.id) || Date.now() + index,
    address_key: mrSavedAddressKey(address),
    name: address.name,
    mobile: address.mobile,
    pin: address.pin,
    house: address.house,
    street: address.street,
    town: address.town,
    city: address.city,
    state: address.state,
    updated_at: new Date().toISOString()
  }));

  const { error: deleteError } = await sb
    .from("saved_addresses")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    console.log(deleteError);
    return false;
  }

  if (rows.length === 0) return true;

  const { error: insertError } = await sb
    .from("saved_addresses")
    .insert(rows);

  if (insertError) {
    console.log(insertError);
    return false;
  }

  return true;
}

async function mrHydrateSavedAddressesFromDatabase({ preferLocal = false, forceRemote = false } = {}) {
  if (localStorage.getItem("isLoggedIn") !== "true") return;

  const localAddresses = mrReadSavedAddresses();
  if (preferLocal && !forceRemote && localAddresses.length > 0) {
    mrQueueSavedAddressesSync(localAddresses);
    return;
  }

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return;

  const { data, error } = await sb
    .from("saved_addresses")
    .select("local_id,name,mobile,pin,house,street,town,city,state,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.log(error);
    if (!forceRemote && localAddresses.length > 0) mrQueueSavedAddressesSync(localAddresses);
    return;
  }

  if (Array.isArray(data) && data.length > 0) {
    mrSaveSavedAddresses(data.map(mrSavedAddressRowToItem), { sync: false });
  } else if (!forceRemote && localAddresses.length > 0) {
    mrQueueSavedAddressesSync(localAddresses);
  } else {
    mrSaveSavedAddresses([], { sync: false });
  }

  mrRefreshAddressViews();
}

function mrStopRealtimeSync() {
  const sb = window.supabaseClient;

  if (sb && mrRealtimeChannel) {
    sb.removeChannel(mrRealtimeChannel);
  }

  mrRealtimeChannel = null;
  mrRealtimeUserId = null;
  mrRealtimePendingAreas.clear();
  clearTimeout(mrRealtimeRefreshTimer);
}

function mrQueueRealtimeRefresh(area) {
  if (!area || localStorage.getItem("isLoggedIn") !== "true") return;

  mrRealtimePendingAreas.add(area);
  clearTimeout(mrRealtimeRefreshTimer);

  mrRealtimeRefreshTimer = setTimeout(async () => {
    const areas = new Set(mrRealtimePendingAreas);
    mrRealtimePendingAreas.clear();

    if (areas.has("profile")) {
      const userId = await mrGetCurrentAuthUserId();
      if (userId) {
        const profile = await mrLoadProfileByUserId(userId);
        if (profile) {
          mrCacheProfile(profile);
          updateNavbar();
          updateProfile();
        }
      }
    }

    if (areas.has("cart")) {
      await mrHydrateCartFromDatabase({ forceRemote: true });
    }

    if (areas.has("wishlist")) {
      await mrHydrateWishlistFromDatabase({ forceRemote: true });
    }

    if (areas.has("orders")) {
      await mrHydrateOrdersFromDatabase({ forceRemote: true });
    }

    if (areas.has("upis")) {
      await mrHydrateSavedUpisFromDatabase({ forceRemote: true });
    }

    if (areas.has("addresses")) {
      await mrHydrateSavedAddressesFromDatabase({ forceRemote: true });
    }
  }, 500);
}

async function mrStartRealtimeSync() {
  if (localStorage.getItem("isLoggedIn") !== "true") {
    mrStopRealtimeSync();
    return;
  }

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId) return;
  if (mrRealtimeChannel && mrRealtimeUserId === userId) return;

  mrStopRealtimeSync();
  mrRealtimeUserId = userId;

  const userFilter = `user_id=eq.${userId}`;
  mrRealtimeChannel = sb
    .channel(`mr-milk-user-sync:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
      () => mrQueueRealtimeRefresh("profile")
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cart_items", filter: userFilter },
      () => mrQueueRealtimeRefresh("cart")
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "wishlist_items", filter: userFilter },
      () => mrQueueRealtimeRefresh("wishlist")
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: userFilter },
      () => mrQueueRealtimeRefresh("orders")
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_items", filter: userFilter },
      () => mrQueueRealtimeRefresh("orders")
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "saved_upis", filter: userFilter },
      () => mrQueueRealtimeRefresh("upis")
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "saved_addresses", filter: userFilter },
      () => mrQueueRealtimeRefresh("addresses")
    )
    .subscribe(status => {
      if (status === "CHANNEL_ERROR") {
        console.log("Realtime sync channel error");
      }
    });
}

async function mrFindLoginProfile({ mobile = "", email = "" } = {}) {
  const sb = mrGetSupabase();
  if (!sb) return null;

  const { data, error } = await sb.rpc("find_profile_for_login", {
    p_mobile: mrNormalizeMobile(mobile) || null,
    p_email: mrNormalizeEmail(email) || null
  });

  if (error) {
    console.log(error);
    alert("Supabase SQL setup missing hai. Pehle find_profile_for_login function create karo.");
    return null;
  }

  return Array.isArray(data) ? data[0] || null : data || null;
}

async function mrLoadProfileByUserId(userId) {
  const sb = mrGetSupabase();
  if (!sb || !userId) return null;

  const { data, error } = await sb
    .from("profiles")
    .select("id,name,mobile,email,dob")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.log(error);
    return null;
  }

  return data;
}

// Creates/updates the profile row after registration or first OTP login.
// This keeps the Supabase `profiles` table aligned with local app profile data.
async function mrUpsertProfileForUser(userId, profile) {
  const sb = mrGetSupabase();
  if (!sb || !userId || !profile) return null;

  const cleanProfile = {
    id: userId,
    name: String(profile.name || "").trim(),
    mobile: mrNormalizeMobile(profile.mobile),
    email: mrNormalizeEmail(profile.email),
    dob: profile.dob || null
  };

  if (!cleanProfile.name || !cleanProfile.email) {
    return null;
  }

  const { data, error } = await sb
    .from("profiles")
    .upsert(cleanProfile, { onConflict: "id" })
    .select("id,name,mobile,email,dob")
    .single();

  if (error) {
    console.log(error);
    return null;
  }

  return data;
}

async function mrUpdateProfileInDatabase(profile) {
  if (localStorage.getItem("isLoggedIn") !== "true") return null;

  const sb = mrGetSupabase();
  const userId = await mrGetCurrentAuthUserId();
  if (!sb || !userId || !profile) return null;

  const updates = {
    name: String(profile.name || "").trim(),
    mobile: mrNormalizeMobile(profile.mobile),
    email: mrNormalizeEmail(profile.email || localStorage.getItem("userEmail"))
  };

  const { data, error } = await sb
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select("id,name,mobile,email,dob,created_at")
    .single();

  if (error) {
    console.log(error);
    return null;
  }

  return data;
}

async function mrSendEmailOtp(email, createUser = false) {
  const sb = mrGetSupabase();
  if (!sb) return false;

  const cleanEmail = mrNormalizeEmail(email);
  const { error } = await sb.auth.signInWithOtp({
    email: cleanEmail,
    options: { shouldCreateUser: createUser }
  });

  if (error) {
    console.log(error);
    alert(error.message);
    return false;
  }

  localStorage.setItem("loginEmail", cleanEmail);
  return true;
}

function mrGetGoogleRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function mrStartGoogleAuth() {
  const sb = mrGetSupabase();
  if (!sb) return;

  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: mrGetGoogleRedirectUrl()
    }
  });

  if (error) {
    console.log(error);
    alert(error.message);
  }
}

function mrProfileFromAuthUser(user) {
  const metadata = user?.user_metadata || {};
  return {
    id: user?.id,
    name:
      metadata.full_name ||
      metadata.name ||
      metadata.display_name ||
      user?.email?.split("@")[0] ||
      "User",
    mobile: localStorage.getItem("userMobile") || "",
    email: user?.email || metadata.email || "",
    dob: ""
  };
}

function mrGetAuthProvider(user) {
  return (
    user?.app_metadata?.provider ||
    user?.identities?.[0]?.provider ||
    ""
  );
}

function mrGetGoogleProviderId(user) {
  const googleIdentity = (user?.identities || [])
    .find(identity => identity.provider === "google");

  return (
    googleIdentity?.identity_data?.sub ||
    googleIdentity?.id ||
    user?.user_metadata?.sub ||
    ""
  );
}

async function mrUpsertGoogleAuthUser(user) {
  const sb = mrGetSupabase();
  if (!sb || !user?.id || mrGetAuthProvider(user) !== "google") return;

  const metadata = user.user_metadata || {};
  const googleRow = {
    id: user.id,
    email: user.email || metadata.email || null,
    full_name:
      metadata.full_name ||
      metadata.name ||
      metadata.display_name ||
      null,
    avatar_url:
      metadata.avatar_url ||
      metadata.picture ||
      null,
    provider: "google",
    provider_user_id: mrGetGoogleProviderId(user) || null,
    phone: user.phone || null,
    email_verified: Boolean(
      metadata.email_verified ||
      user.email_confirmed_at
    ),
    raw_user_meta_data: metadata,
    raw_app_meta_data: user.app_metadata || {},
    last_seen_at: new Date().toISOString()
  };

  const { error } = await sb
    .from("google_auth_users")
    .upsert(googleRow, { onConflict: "id" });

  if (error) {
    console.log("Google auth user sync failed", error);
  }
}

async function mrCompleteAuthLogin(user) {
  if (!user?.id) return false;

  await mrUpsertGoogleAuthUser(user);

  let profile = await mrLoadProfileByUserId(user.id);

  if (!profile) {
    profile = await mrUpsertProfileForUser(user.id, mrProfileFromAuthUser(user));
  } else if (!profile.name || !profile.email) {
    const authProfile = mrProfileFromAuthUser(user);
    const savedProfile = await mrUpsertProfileForUser(user.id, {
      ...profile,
      name: profile.name || authProfile.name,
      email: profile.email || authProfile.email,
      mobile: profile.mobile || authProfile.mobile
    });
    if (savedProfile) profile = savedProfile;
  }

  if (!profile) return false;

  mrCacheProfile(profile);
  await mrHydrateCartFromDatabase({ preferLocal: true });
  await mrHydrateWishlistFromDatabase({ preferLocal: true });
  await mrHydrateOrdersFromDatabase({ preferLocal: true });
  await mrHydrateSavedUpisFromDatabase({ preferLocal: true });
  await mrHydrateSavedAddressesFromDatabase({ preferLocal: true });
  await mrStartRealtimeSync();
  updateNavbar();
  updateProfile();
  renderDailyDeliveryCard();
  return true;
}

async function mrHandleExistingAuthSession() {
  const sb = mrGetSupabase();
  if (!sb) return;

  const { data, error } = await sb.auth.getSession();
  if (error || !data?.session?.user) return;

  const completed = await mrCompleteAuthLogin(data.session.user);
  if (completed && ["login", "register", "otp", "success"].includes(getActiveScreenName())) {
    setActiveScreen("home", { replace: true });
  }
}

// Enables/disables login button styling based on email/mobile input.
function mrUpdateLoginButton() {
  const mobile = document.getElementById("loginMobileInput")?.value.trim();
  const email = document.getElementById("loginEmailInput")?.value.trim();
  const policyChecked = document.getElementById("loginPolicyCheckbox")?.checked;
  const btn = document.querySelector(".get-otp-btn");
  if (!btn) return;

  const active = Boolean((mobile || email) && policyChecked);
  btn.style.background = active ? "#7fcdf4" : "#d3d3d3";
  btn.style.color = active ? "#fff" : "#222";
  btn.disabled = !active;
  btn.setAttribute("aria-disabled", active ? "false" : "true");
}

// Collects register form elements in one place so validation code stays simple.
function mrGetRegisterFields() {
  return {
    name: document.getElementById("registerNameInput"),
    mobile: document.getElementById("registerMobileInput"),
    email: document.getElementById("registerEmailInput"),
    dob: document.getElementById("registerDobInput"),
    policy: document.getElementById("registerPolicyCheckbox"),
    button: document.querySelector(".create-btn")
  };
}

function mrIsRegisterFormFilled() {
  const { name, mobile, email, dob, policy } = mrGetRegisterFields();
  return Boolean(
    name?.value.trim() &&
    mrNormalizeMobile(mobile?.value) &&
    mrNormalizeEmail(email?.value) &&
    dob?.value &&
    policy?.checked
  );
}

function mrUpdateRegisterButton() {
  const { button } = mrGetRegisterFields();
  if (!button) return;

  const active = mrIsRegisterFormFilled();
  button.style.background = active ? "#7fcdf4" : "#d5e4eb";
  button.style.color = active ? "#fff" : "#8b8b8b";
  button.setAttribute("aria-disabled", active ? "false" : "true");
  button.disabled = !active;
}

// Converts DOB text input to native date picker only when user taps/focuses it.
function mrSetupDobInput() {
  const { dob } = mrGetRegisterFields();
  if (!dob) return;

  const openDatePicker = () => {
    if (dob.type !== "date") dob.type = "date";
    if (typeof dob.showPicker === "function") {
      try {
        dob.showPicker();
      } catch (error) {
        // Some mobile browsers only allow the native picker from direct taps.
      }
    }
  };

  dob.addEventListener("focus", openDatePicker);
  dob.addEventListener("click", openDatePicker);
  dob.addEventListener("blur", () => {
    if (!dob.value) dob.type = "text";
    mrUpdateRegisterButton();
  });
}

document.querySelectorAll("#register-screen .register-line-input").forEach(input => {
  input.addEventListener("input", mrUpdateRegisterButton);
  input.addEventListener("change", mrUpdateRegisterButton);
});
document
  .getElementById("registerPolicyCheckbox")
  ?.addEventListener("change", mrUpdateRegisterButton);
mrSetupDobInput();
mrUpdateRegisterButton();

document.querySelectorAll("[data-register-policy-link]").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const target = button.dataset.registerPolicyLink === "privacy"
      ? "privacy"
      : "terms";
    setActiveScreen(target);
  });
});

document.getElementById("loginMobileInput")?.addEventListener("input", mrUpdateLoginButton);
document.getElementById("loginEmailInput")?.addEventListener("input", mrUpdateLoginButton);
document
  .getElementById("loginPolicyCheckbox")
  ?.addEventListener("change", mrUpdateLoginButton);
mrUpdateLoginButton();

document.querySelectorAll("[data-login-policy-link]").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const target = button.dataset.loginPolicyLink === "privacy"
      ? "privacy"
      : "terms";
    setActiveScreen(target);
  });
});

document.querySelectorAll("[data-google-auth]").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    mrStartGoogleAuth();
  }, true);
});

mrHandleExistingAuthSession();

// Main login button:
// 1. Validate email/mobile.
// 2. Find existing profile in Supabase.
// 3. Send OTP to registered email.
// 4. Open OTP screen.
document.querySelector(".get-otp-btn")?.addEventListener("click", async event => {
  event.preventDefault();
  event.stopImmediatePropagation();

  const mobile = mrNormalizeMobile(document.getElementById("loginMobileInput")?.value);
  const email = mrNormalizeEmail(document.getElementById("loginEmailInput")?.value);

  if (!email) {
    alert("Please enter email");
    return;
  }

  if (mobile && !mrIsValidMobile(mobile)) {
    alert("Please enter a valid 10 digit mobile number");
    return;
  }

  if (email && !mrIsValidEmail(email)) {
    alert("Please enter a valid email");
    return;
  }

  const profile = await mrFindLoginProfile({ mobile, email });

  if (!profile) {
    const inputs = document.querySelectorAll("#register-screen .register-line-input");
    if (inputs[1]) inputs[1].value = mobile;
    if (inputs[2]) inputs[2].value = email;
    mrUpdateRegisterButton();
    alert("Email not registered. Please create account.");
    setActiveScreen("register");
    return;
  }

  if (!profile.email) {
    alert("Is account me email saved nahi hai.");
    return;
  }

  const sent = await mrSendEmailOtp(profile.email, false);
  if (!sent) return;

  localStorage.setItem("pendingLoginProfile", JSON.stringify(profile));
  localStorage.setItem("pendingUserKey", mrNormalizeEmail(profile.email) || mrNormalizeMobile(profile.mobile));

  resetOtpBoxes();

  alert("OTP sent to your registered email");
  setActiveScreen("otp");
  startResendOtpTimer();
  // Focus on first OTP box
  document.querySelector(".otp-box")?.focus();
}, true);

/* ================= OTP BOXES AND RESEND TIMER =================
   OTP screen uses 6 individual boxes. This block moves focus automatically,
   handles paste, verifies OTP once complete, and manages resend countdown.
*/
let resendOtpTimer = null;
let resendOtpSecondsLeft = 0;

function updateOtpResendTimerDisplay() {
  const timerEl = document.querySelector(".otp-resend-timer");
  const btn = document.querySelector(".resend-otp-btn");
  if (!timerEl || !btn) return;

  if (resendOtpSecondsLeft > 0) {
    timerEl.textContent = `Resend OTP in ${resendOtpSecondsLeft} second${resendOtpSecondsLeft === 1 ? "" : "s"}`;
    btn.disabled = true;
  } else {
    timerEl.textContent = "You can resend OTP now.";
    btn.disabled = false;
  }
}

function startResendOtpTimer() {
  const btn = document.querySelector(".resend-otp-btn");
  if (!btn) return;

  resendOtpSecondsLeft = 15;
  updateOtpResendTimerDisplay();

  if (resendOtpTimer) {
    clearInterval(resendOtpTimer);
  }

  resendOtpTimer = setInterval(() => {
    resendOtpSecondsLeft -= 1;
    updateOtpResendTimerDisplay();

    if (resendOtpSecondsLeft <= 0) {
      clearInterval(resendOtpTimer);
      resendOtpTimer = null;
      updateOtpResendTimerDisplay();
    }
  }, 1000);
}

function resetOtpBoxes() {
  document.querySelectorAll(".otp-box").forEach(box => {
    box.value = "";
    box.classList.remove("filled");
  });
}

// OTP Box Logic - Auto-focus and auto-submit
function setupOtpBoxes() {
  const otpBoxes = document.querySelectorAll(".otp-box");

  otpBoxes.forEach((box, index) => {
    if (box.dataset.otpBound === "true") return;
    box.dataset.otpBound = "true";

    // Handle input
    box.addEventListener("input", async (event) => {
      const value = event.target.value.replace(/\D/g, "").slice(-1);
      event.target.value = value;

      // Only allow digits
      if (!value) {
        event.target.classList.remove("filled");
        return;
      }

      // Move to next box if digit entered
      if (value.length === 1 && index < otpBoxes.length - 1) {
        event.target.classList.add("filled");
        otpBoxes[index + 1].focus();
      }

      // Check if all boxes are filled
      const allFilled = Array.from(otpBoxes).every(b => b.value.length === 1);
      if (allFilled) {
        // Auto-verify OTP
        await verifyOtpAuto();
      }
    });

    // Handle backspace
    box.addEventListener("keydown", (event) => {
      if (event.key === "Backspace") {
        event.preventDefault();
        if (box.value.length === 0 && index > 0) {
          otpBoxes[index - 1].focus();
          otpBoxes[index - 1].value = "";
          otpBoxes[index - 1].classList.remove("filled");
        } else if (box.value.length === 1) {
          box.value = "";
          box.classList.remove("filled");
        }
      }
    });

    // Handle paste
    box.addEventListener("paste", (event) => {
      event.preventDefault();
      const pastedData = event.clipboardData.getData("text");
      const digits = pastedData.replace(/\D/g, "").slice(0, 6);

      otpBoxes.forEach((b, i) => {
        b.value = digits[i] || "";
        if (b.value) b.classList.add("filled");
        else b.classList.remove("filled");
      });

      // Focus last filled box or next empty
      const lastIndex = Math.min(digits.length, otpBoxes.length - 1);
      otpBoxes[lastIndex]?.focus();

      // Check if all filled
      if (digits.length === 6) {
        setTimeout(() => verifyOtpAuto(), 100);
      }
    });
  });
}

// Verify OTP automatically
async function verifyOtpAuto() {
  const otpBoxes = document.querySelectorAll(".otp-box");
  const token = Array.from(otpBoxes).map(b => b.value).join("");

  if (token.length !== 6) return;

  const email = localStorage.getItem("loginEmail");
  if (!email) {
    alert("Please request OTP again");
    setActiveScreen("login");
    return;
  }

  const sb = mrGetSupabase();
  if (!sb) return;

  const { data, error } = await sb.auth.verifyOtp({
    email,
    token,
    type: "email"
  });

  if (error) {
    console.log(error);
    alert("Invalid OTP");
    // Clear boxes on error
    otpBoxes.forEach(b => {
      b.value = "";
      b.classList.remove("filled");
    });
    otpBoxes[0]?.focus();
    return;
  }

  const userId = data?.user?.id;
  let profile = await mrLoadProfileByUserId(userId);
  if (!profile) {
    try {
      profile = JSON.parse(localStorage.getItem("pendingLoginProfile")) || null;
    } catch (error) {
      profile = null;
    }

    const savedProfile = await mrUpsertProfileForUser(userId, profile);
    if (savedProfile) profile = savedProfile;
  }

  if (!profile) {
    alert("Profile not found. Please register again.");
    setActiveScreen("register");
    return;
  }

  mrCacheProfile(profile);
  await mrHydrateCartFromDatabase({ preferLocal: true });
  await mrHydrateWishlistFromDatabase({ preferLocal: true });
  await mrHydrateOrdersFromDatabase({ preferLocal: true });
  await mrHydrateSavedUpisFromDatabase({ preferLocal: true });
  await mrHydrateSavedAddressesFromDatabase({ preferLocal: true });
  await mrStartRealtimeSync();
  document.querySelector(".success-sub").textContent = "Log In";
  document.querySelector(".success-main").textContent = "Successfully!!!";
  setActiveScreen("success");

  setTimeout(() => {
    updateNavbar();
    updateProfile();
    renderDailyDeliveryCard();
    setActiveScreen("home");
  }, 1000);
}

// Initialize OTP boxes when page loads
setupOtpBoxes();

document.querySelector(".resend-otp-btn")?.addEventListener("click", async event => {
  event.preventDefault();
  const email = localStorage.getItem("loginEmail");
  if (email) {
    const sent = await mrSendEmailOtp(email, false);
    if (!sent) return;
    startResendOtpTimer();
    alert("OTP resent to your email");
    const otpBoxes = document.querySelectorAll(".otp-box");
    otpBoxes.forEach(b => {
      b.value = "";
      b.classList.remove("filled");
    });
    otpBoxes[0]?.focus();
  }
});

document.querySelectorAll(".create-account-link").forEach(btn => {
  btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const inputs = document.querySelectorAll("#register-screen .register-line-input");
    const mobile = mrNormalizeMobile(document.getElementById("loginMobileInput")?.value);
    const email = mrNormalizeEmail(document.getElementById("loginEmailInput")?.value);
    if (inputs[1] && mobile) inputs[1].value = mobile;
    if (inputs[2] && email) inputs[2].value = email;
    mrUpdateRegisterButton();
    setActiveScreen("register");
  }, true);
});

document.querySelector(".create-btn")?.addEventListener("click", async event => {
  event.preventDefault();
  event.stopImmediatePropagation();

  const inputs = document.querySelectorAll("#register-screen .register-line-input");
  const name = inputs[0]?.value.trim();
  const mobile = mrNormalizeMobile(inputs[1]?.value);
  const email = mrNormalizeEmail(inputs[2]?.value);
  const dob = inputs[3]?.value;

  if (!name || !mobile || !email || !dob) {
    alert("Please fill all details");
    return;
  }

  if (!mrIsValidMobile(mobile)) {
    alert("Please enter a valid 10 digit mobile number");
    return;
  }

  if (!mrIsValidEmail(email)) {
    alert("Please enter a valid email");
    return;
  }

  const existing = await mrFindLoginProfile({ email });
  if (existing) {
    alert("Account already exists. Please login with OTP.");
    setActiveScreen("login");
    return;
  }

  const sb = mrGetSupabase();
  if (!sb) return;

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: { name, mobile, dob }
    }
  });

  if (error) {
    console.log(error);
    alert(error.message);
    return;
  }

  const profile = {
    name,
    mobile,
    email,
    dob
  };

  localStorage.setItem("pendingLoginProfile", JSON.stringify(profile));
  localStorage.setItem("loginEmail", email);
  alert("OTP sent to your email. Enter OTP to complete registration.");
  resetOtpBoxes();
  setActiveScreen("otp");
  startResendOtpTimer();
}, true);
    const mobileInput = document.querySelector('.login-input:nth-child(2)');
    const otpBtn = document.querySelector('.get-otp-btn');

    const loginInputs = document.querySelectorAll('.login-input');

loginInputs.forEach(input => {
  input.addEventListener('input', () => {
    let isFilled = false;

    loginInputs.forEach(inp => {
      if (inp.value.trim() !== '') {
        isFilled = true;
      }
    });

    if (isFilled) {
      otpBtn.style.background = "#7fcdf4";
      otpBtn.style.color = "#fff";
    } else {
      otpBtn.style.background = "#d3d3d3";
      otpBtn.style.color = "#222";
    }
  });
});
const getOtpBtn = document.querySelector('.get-otp-btn');
function updateNavbar() {
  const navUser = document.getElementById("nav-user");

  const isLoggedIn = localStorage.getItem("isLoggedIn");
  const name = localStorage.getItem("userName");

  if (isLoggedIn === "true" && name) {
    navUser.textContent = "Welcome, " + name;
  } else {
    navUser.textContent = "Log In";
  }
}

getOtpBtn.addEventListener('click', async () => {

  const enteredMobile =
    document.querySelectorAll('.login-input')[0]
    .value.trim();

  const enteredEmail =
    document.querySelectorAll('.login-input')[1]
    .value.trim();

  const savedMobile =
    localStorage.getItem("userMobile");

  const savedEmail =
    localStorage.getItem("userEmail");

  // 🔥 user exists check
  if (
    enteredMobile !== savedMobile &&
    enteredEmail !== savedEmail
  ) {

    setActiveScreen('register');
    return;
  }

  // 🔥 SEND EMAIL OTP
  const { data, error } =
   await supabaseClient.auth.signInWithOtp({

  email: enteredEmail,

  options: {
  shouldCreateUser: false
}

});

  if (error) {

    console.log(error);

    alert(error.message);

    return;
  }

  // 🔥 save login email
  localStorage.setItem(
    "loginEmail",
    enteredEmail
  );
  localStorage.setItem(
    "pendingUserKey",
    enteredMobile || enteredEmail
  );

  alert("OTP sent to your email 📩");

  setActiveScreen('otp');

});
const otpInput = document.querySelector('.otp-input');
const successSub = document.querySelector('.success-sub');
const successMain = document.querySelector('.success-main');

otpInput?.addEventListener('input', async () => {

  const value = otpInput.value.trim();

  if (value.length === 6) {

    const email =
      localStorage.getItem("loginEmail");

    const { data, error } =
      await supabaseClient.auth.verifyOtp({

        email: email,
        token: value,
        type: "email"

      });

    if (error) {

      console.log(error);

      alert("Invalid OTP ?");

      return;
    }

    successSub.textContent =
      "Log In";

    successMain.textContent =
      "Successfully!!!";

    localStorage.setItem(
      "isLoggedIn",
      "true"
    );
    localStorage.setItem(
      "currentUserKey",
      localStorage.getItem("pendingUserKey") || email
    );

    isLoggedIn = true;
    await mrHydrateCartFromDatabase({ preferLocal: true });
    await mrHydrateWishlistFromDatabase({ preferLocal: true });
    await mrHydrateOrdersFromDatabase({ preferLocal: true });
    await mrHydrateSavedUpisFromDatabase({ preferLocal: true });
    await mrHydrateSavedAddressesFromDatabase({ preferLocal: true });
    await mrStartRealtimeSync();

    setActiveScreen('success');

    setTimeout(() => {

      updateNavbar();
      updateProfile();

      setActiveScreen('home');

    }, 1000);
  }
});


const createAccountBtns = document.querySelectorAll(".create-account-link");

createAccountBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    setActiveScreen("register");
  });
});

function setupRegisterInputs() {
  const registerInputs = document.querySelectorAll("#register-screen .register-line-input");
  const createBtn =
  document.querySelector(".create-btn");

const newCreateBtn = createBtn;

  function checkRegisterForm() {
    let allFilled = true;

    registerInputs.forEach(inp => {
      if (!inp.value.trim()) allFilled = false;
    });

    if (allFilled) {
      newCreateBtn.style.background = "#7fcdf4";
      newCreateBtn.style.color = "#fff";
    } else {
      newCreateBtn.style.background = "#d5e4eb";
      newCreateBtn.style.color = "#8b8b8b";
    }

    return allFilled;
  }

  registerInputs.forEach(input => {
    input.addEventListener("input", checkRegisterForm);
  });

  newCreateBtn.addEventListener("click", async () => {
    if (!checkRegisterForm()) return;

    const name = registerInputs[0].value.trim();
    const mobile = registerInputs[1].value.trim();
    const email = registerInputs[2].value.trim();
    const dob = registerInputs[3].value;

   // 🔥 CLEAN MOBILE
const cleanMobile =
  mobile.replace(/^0+/, "");

// 🔥 CHECK EXISTING USER
const { data: existingUser, error: checkError } =
  await supabaseClient
    .from("Users")
    .select("*");

if (checkError) {
  console.log(checkError);
  alert("User check failed");
  return;
}

// 🔥 MATCH EMAIL OR MOBILE
const alreadyExists =
  existingUser.some(user => {

    const dbMobile =
      String(user.mobile).replace(/^0+/, "");

    return (
      user.email === email ||
      dbMobile === cleanMobile
    );
  });

// 🔥 USER EXISTS
if (alreadyExists) {

  alert("Account already exists. Please login.");

  setActiveScreen("login");

  return;
}
const { data: authData, error: authError } =
  await supabaseClient.auth.signUp({
    email: email,
    password: mobile
  });

if (authError) {
  console.log(authError);
  alert(authError.message);
  return;
}
    const { data, error } = await supabaseClient
  .from("Users")
  .insert([
    {
      name: name,
      mobile: mobile,
      email: email,
      dob: dob
    }
  ]);
  if (error) {

  console.log(error);

  // 🔥 duplicate email/mobile
  if (
    error.message.includes("duplicate") ||
    error.message.includes("unique")
  ) {

    alert(
      "Account already exists. Please login."
    );

    setActiveScreen("login");

  }

  else {

    alert(error.message);

  }

  return;
}
// 🔥 SAVE USER DATA
localStorage.setItem("userName", name);
localStorage.setItem("userMobile", mobile);
localStorage.setItem("userEmail", email);
localStorage.setItem("currentUserKey", email || mobile);

    successSub.textContent = "Account Created";
    successMain.textContent = "Successfully!!!";

    localStorage.setItem("isLoggedIn", "true");
    isLoggedIn = true;
    await mrStartRealtimeSync();
    setActiveScreen("success");

    setTimeout(() => {
  updateNavbar();
  updateProfile(); // 🔥 ADD THIS
  setActiveScreen("home");
}, 1000);
  });
}

// Registration is handled by the Supabase OTP flow above.
function loadProfileData() {
  const name = localStorage.getItem('userName');
  const mobile = localStorage.getItem('userMobile');
  const email = localStorage.getItem('userEmail');

  if (name) {
    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-mobile').textContent = mobile || email || "";
  }
}

const logoutBtn = document.querySelector('.logout-btn');
const logoutModal = document.getElementById('logoutModal');
const yesBtn = document.querySelector('.yes-btn');
const cancelBtn = document.querySelector('.cancel-btn');
const paymentCancelModal = document.getElementById('paymentCancelModal');
const paymentCancelYesBtn = document.querySelector('.payment-cancel-yes');
const paymentCancelNoBtn = document.querySelector('.payment-cancel-no');
const orderCancelModal = document.getElementById('orderCancelModal');
const orderCancelYesBtn = document.querySelector('.order-cancel-yes');
const orderCancelNoBtn = document.querySelector('.order-cancel-no');

// open modal
logoutBtn.addEventListener('click', () => {
  logoutModal.classList.add('active');
});

// YES → logout
/* ================= LOGOUT, MODALS, PROFILE EDIT, PLAN POPUPS =================
   Logout modal clears auth state and realtime channel.
   Profile edit updates localStorage and Supabase profile row.
   Plan popup explains monthly/15 days/weekly/customized plan benefits.
*/
yesBtn.addEventListener('click', async () => {

  // 🔥 sirf login session remove karo
  mrStopRealtimeSync();
  await window.supabaseClient?.auth?.signOut();
  localStorage.setItem("isLoggedIn", "false");
  localStorage.removeItem("userName");
  localStorage.removeItem("userMobile");
  localStorage.removeItem("userEmail");
  localStorage.removeItem("currentUserKey");
  localStorage.removeItem("loginEmail");
  localStorage.removeItem("pendingLoginProfile");
  localStorage.removeItem("pendingUserKey");

  isLoggedIn = false;

  updateNavbar();
  updateProfile();

  logoutModal.classList.remove('active');

  setActiveScreen('login');
});

// CANCEL → close modal
cancelBtn.addEventListener('click', () => {
  logoutModal.classList.remove('active');
});

paymentCancelYesBtn?.addEventListener('click', () => {
  hidePaymentCancelModal();
  stopUpiQrTimer();
  setActiveScreen('orders', { replace: true });
});

paymentCancelNoBtn?.addEventListener('click', () => {
  hidePaymentCancelModal();
});

paymentCancelModal?.addEventListener('click', event => {
  if (event.target === paymentCancelModal) {
    hidePaymentCancelModal();
  }
});

orderCancelYesBtn?.addEventListener('click', () => {
  if (pendingOrderCancel) {
    cancelProfileOrderItem(pendingOrderCancel.orderId, pendingOrderCancel.itemIndex);
  }
  hideOrderCancelModal();
});

orderCancelNoBtn?.addEventListener('click', () => {
  hideOrderCancelModal();
});

orderCancelModal?.addEventListener('click', event => {
  if (event.target === orderCancelModal) {
    hideOrderCancelModal();
  }
});
// Clickable blue profile card opens edit profile screen.
const profileCard = document.getElementById('profile-card-click');

if (profileCard) {
  profileCard.addEventListener('click', () => {
    loadEditProfileData();
    setActiveScreen('editProfile');
  });
}
function loadEditProfileData() {
  const name = localStorage.getItem('userName');
  const mobile = localStorage.getItem('userMobile');
  const email = localStorage.getItem('userEmail');

  document.getElementById('edit-name').value = name || '';
  document.getElementById('edit-mobile').value = mobile || '';
  document.getElementById('edit-email').value = email || '';
}
// Save profile edit form and push the edited name/mobile to Supabase.
const updateBtn = document.querySelector('.update-btn');

updateBtn.addEventListener('click', async () => {
  const name = document.getElementById('edit-name').value;
  const mobile = document.getElementById('edit-mobile').value;
  const email = localStorage.getItem('userEmail');

  localStorage.setItem('userName', name);
  localStorage.setItem('userMobile', mobile);
  localStorage.setItem('currentUserKey', email || mobile || name);

  localStorage.setItem("isLoggedIn", "true");
const savedProfile = await mrUpdateProfileInDatabase({ name, mobile, email });
if (savedProfile) {
  mrCacheProfile(savedProfile);
} // 🔥 IMPORTANT
updateNavbar(); // 🔥 UI update
updateProfile(); // 🔥 ADD THIS

  setActiveScreen('profileSuccess');

  // 2 sec baad automatically profile screen pe
  setTimeout(() => {
    setActiveScreen('profile');
  }, 2000);
});
// Subscription plan modal content: same modal, different feature list per plan.
const planModal = document.getElementById('planModal');
const planTitle = document.getElementById('planTitle');
const planFeatures = document.getElementById('planFeatures');
const miniPlanCards = document.querySelectorAll('.mini-plan-card');

const subscriptionPlanDetails = {
  monthly: {
    title: "30 Days Subscription Plan",
    features: [
      "Best for stable daily dairy needs",
      "Morning or evening delivery slot",
      "Add quantity or switch products with more flexibility",
      "Choose your own start date",
      "Pause up to 7 days",
      "Refund available for pauses/cancellation after extra charges adjustment"
    ]
  },
  fifteenDays: {
    title: "15 Days Subscription Plan",
    features: [
      "Balanced plan for two-week delivery",
      "Morning or evening delivery slot",
      "Add extra quantity or products for selected days",
      "Switch products within the same category",
      "Pause up to 3 days",
      "Refund only for paused days"
    ]
  },
  weekly: {
    title: "7 Days Subscription Plan",
    features: [
      "Short trial plan with low commitment",
      "Morning or evening delivery slot",
      "Add quantity or product for specific days",
      "Switch products within the same category",
      "Pause allowed for 1 day",
      "No cancellation or pause refund"
    ]
  },
  customised: {
    title: "Customised Subscription Plan",
    features: [
      "Choose custom start and end dates",
      "Best for changing quantity or delivery days",
      "Morning or evening delivery slot",
      "Add products for selected dates",
      "Useful for guests, travel, or irregular needs",
      "Pricing follows selected dates, product, and quantity"
    ]
  }
};

function openPlanModal(planKey) {
  const plan = subscriptionPlanDetails[planKey] || subscriptionPlanDetails.monthly;
  planTitle.textContent = plan.title;
  planFeatures.innerHTML = plan.features
    .map(feature => `<li>${feature}</li>`)
    .join("");
  planModal.classList.add('active');
}

miniPlanCards.forEach((card, index) => {
  card.addEventListener('click', (e) => {
    e.stopPropagation();

    if (index === 0) {
      openPlanModal("monthly");
    } 
    else if (index === 1) {
      openPlanModal("fifteenDays");
    }
    else if (index === 2) {
  openPlanModal("weekly");
}
  });
});

// close on outside click
planModal.addEventListener('click', (e) => {
  if (e.target === planModal) {
    planModal.classList.remove('active');
  }
});
const heroImage = document.getElementById("heroImage");

const images = [
  "images/Banner 1.png",
  "images/Banner 2.png",
  "images/Banner 3.png"
];

let index = 0;

setInterval(() => {

  // fade out
  heroImage.style.opacity = 0;

  setTimeout(() => {
    // image change
    index = (index + 1) % images.length;
    heroImage.src = images[index];

    // fade in
    heroImage.style.opacity = 1;

  }, 400);

}, 3000);
const rechargeCards = document.querySelectorAll('.recharge-card');
const amountInput = document.querySelector('.amount-input');

const paymentCards = document.querySelectorAll('.payment-card');

rechargeCards.forEach(card => {
  card.addEventListener('click', () => {
    const amount = card.dataset.amount;

    amountInput.value = amount;

    // highlight recharge
    rechargeCards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');

    // glow effect
    paymentCards.forEach(p => p.classList.add('glow'));

    setTimeout(() => {
      paymentCards.forEach(p => p.classList.remove('glow'));
    }, 2000);
  });
});
const upiRow = document.querySelector('.upi-row');
const cardForm = document.querySelector('.card-form');

paymentCards.forEach(card => {
  card.addEventListener('click', () => {

    paymentCards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');

    const selected = card.textContent.trim();

    if (selected === "UPI") {
  upiRow.style.display = "flex";
  cardForm.style.display = "none";

  // 🔥 RESET
  upiInput.value = "";
  upiPayBtn.style.opacity = "0.5";
  upiPayBtn.style.pointerEvents = "none";
}
    else if (selected === "Card") {
      upiRow.style.display = "none";
      cardForm.style.display = "flex";
    } 
    else {
      upiRow.style.display = "none";
      cardForm.style.display = "none";
    }

  });
});
const cardNumberInput = document.querySelector('.card-number');
if (cardNumberInput) {
cardNumberInput.addEventListener('input', () => {
  let value = cardNumberInput.value.replace(/\D/g, ""); // only numbers

  value = value.substring(0, 16); // max 16 digits

  value = value.replace(/(.{4})/g, "$1 ").trim(); // spacing

  cardNumberInput.value = value;
})};
const cvvInput = document.querySelector('.cvv-input');

if (cvvInput) {
  cvvInput.addEventListener('input', () => {
    let value = cvvInput.value.replace(/\D/g, "");
    cvvInput.value = value.substring(0, 3);
  });
}
const expiryInput = document.querySelector('.expiry-input');
if (expiryInput) {
  expiryInput.addEventListener('input', () => {
    let value = expiryInput.value.replace(/\D/g, "");

    if (value.length >= 3) {
      value = value.substring(0, 2) + "/" + value.substring(2, 4);
    }

    expiryInput.value = value;
  });
}
const cardInputs = document.querySelectorAll('.card-form input');
const payBtn = document.querySelector('.card-pay-btn');

cardInputs.forEach(input => {
  input.addEventListener('input', () => {

    let allFilled = true;

    cardInputs.forEach(inp => {
      if (inp.value.trim() === "") {
        allFilled = false;
      }
    });

    if (allFilled) {
      payBtn.style.opacity = "1";
      payBtn.style.pointerEvents = "auto";
    } else {
      payBtn.style.opacity = "0.5";
      payBtn.style.pointerEvents = "none";
    }

  });
});
const nameInput = document.querySelector('.name-input');

if (nameInput) {
  nameInput.addEventListener('input', () => {
    let value = nameInput.value;

    value = value.replace(/[^a-zA-Z\s]/g, "");
    value = value.replace(/\b\w/g, char => char.toUpperCase());

    nameInput.value = value;
  });
}
const upiInput = document.querySelector('.upi-input');
const upiPayBtn = document.querySelector('.upi-pay-btn');

if (upiInput) {
  upiInput.addEventListener('input', () => {
    let value = upiInput.value;

    value = value.replace(/\s/g, "");
    upiInput.value = value;

    const parts = value.split('@');

    if (parts.length === 2 && parts[1].length > 0) {
      upiPayBtn.style.opacity = "1";
      upiPayBtn.style.pointerEvents = "auto";
    } else {
      upiPayBtn.style.opacity = "0.5";
      upiPayBtn.style.pointerEvents = "none";
    }
  });
}

amountInput.addEventListener('input', () => {
  const value = amountInput.value.trim();

  let matched = false;

  rechargeCards.forEach(card => {
    const amount = card.dataset.amount;

    if (value === amount) {
      rechargeCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      matched = true;
    }
  });
  // ? no match → remove highlight
  if (!matched) {
    rechargeCards.forEach(c => c.classList.remove('active'));
  }

  // 🔥 ALWAYS GLOW (chahe match ho ya na ho)
  if (value !== "") {
    paymentCards.forEach(p => p.classList.add('glow'));

    setTimeout(() => {
      paymentCards.forEach(p => p.classList.remove('glow'));
    }, 2000);
  }
});
const getStartedBtn = document.querySelector('.plan-btn');
const subscribeNowBtn = document.querySelector('.primary-cta');

subscribeNowBtn.addEventListener('click', () => {
  setActiveScreen('products');
});

getStartedBtn.addEventListener('click', () => {
  getStartedBtn.style.transform = "scale(0.95)";
  getStartedBtn.style.boxShadow = "0 0 15px #7fcdf4";

  setTimeout(() => {
    getStartedBtn.style.transform = "scale(1)";
  }, 150);

  planModal.classList.remove('active');

  // 🔥 ADD THIS
  setActiveScreen('products');
});
const subscribeBtns = document.querySelectorAll('.buy-btn');
const featuredCards = document.querySelectorAll('.featured-card');
let selectedPlanType = "";
let count = 1;
let editingCartIndex = null;
let completingCartDetailsIndex = null;
let cartDetailsAutoReturnTimer = null;
let cartDetailsAutoSaveInProgress = false;

function updatePlanOptionsForProduct() {
  const isOneTimeOnlyProduct =
    currentProduct === "GHEE" || currentProduct === "PANEER";

  document.querySelectorAll('.plan-pill').forEach(btn => {
    const isOneTimeOnly =
      btn.textContent.trim() === "One Time Only";

    btn.style.display =
      !isOneTimeOnlyProduct || isOneTimeOnly ? "" : "none";
    btn.classList.remove('active');
  });

  selectedPlanType = "";
  document.getElementById('custom-dates-wrap').innerHTML = "";
  document.getElementById('start-date').value = "";
  document.getElementById('end-date').value = "";
  document.getElementById('start-date').disabled = true;
  document.getElementById('end-date').disabled = true;
  document.getElementById('end-date').readOnly = true;
  document.getElementById('start-date').classList.remove('date-glow');
  document.getElementById('end-date').classList.remove('date-glow');
  updateProductDatePlaceholders();
  checkForm();
}

function openProductDetailFromCard(card) {
  if (!card) return;

  const detailQuantitySelect = document.getElementById('quantity-select');
  const detailSlotSelect = document.getElementById('slot-select');
  const detailStartDate = document.getElementById('start-date');
  const detailEndDate = document.getElementById('end-date');
  const detailPacketCount = document.getElementById('packet-count');
  const detailCustomDatesWrap = document.getElementById('custom-dates-wrap');

  currentProduct = ""; // 🔥 RESET EVERY TIME
  selectedPlanType = "";

  document.querySelectorAll('.plan-pill')
    .forEach(p => p.classList.remove('active'));

  detailCustomDatesWrap.innerHTML = "";
  detailStartDate.value = "";
  detailEndDate.value = "";
  detailStartDate.disabled = true;
  detailEndDate.disabled = true;
  detailEndDate.readOnly = true;
  detailStartDate.classList.remove('date-glow');
  detailEndDate.classList.remove('date-glow');
  updateProductDatePlaceholders();
  detailSlotSelect.value = "";
  detailQuantitySelect.selectedIndex = 0;
  count = 1;
  detailPacketCount.textContent = 1;

  document.getElementById('buy-now-btn').disabled = true;
  document.getElementById('cart-btn').disabled = true;
  document.getElementById('buy-now-btn').style.background = "#dcdcdc";
  document.getElementById('cart-btn').style.background = "#dcdcdc";
  document.getElementById('cart-btn').textContent = "Add to Cart";

  const name = card.querySelector('h3').textContent;
  const catalog = getProductCatalog(name);
  if (catalog && !catalog.isAvailable) {
    showToast(catalog.availabilityMessage || "This product is out of stock");
    return;
  }

  const price = card.querySelector('strong').textContent;
  const image = setDetailProductImage(
    name,
    card.querySelector('img')?.getAttribute('src') || card.querySelector('img')?.src
  );

  document.getElementById('detail-name').textContent = name;
  currentProductName = name;
  rememberViewedProduct({ name, price, image });

  if (name === "RAW A2 COW MILK") {
    currentProduct = "A2";
    basePrice = 80;
    document.getElementById('detail-price').textContent = "Price: ₹85/L";
    document.getElementById('product-description').innerHTML = `
• Premium quality A2 milk obtained from indigenous Sahiwal cows known for their naturally nutritious milk.<br><br>
• Contains A2 protein which is easier to digest and considered healthier compared to regular milk varieties.<br><br>
• Rich source of calcium, protein, and natural nutrients that help support immunity, digestion, and overall wellness.<br><br>
• Freshly collected and delivered with care to preserve purity, taste, and authentic farm freshness every day.
`;
  }
  else if (name === "RAW COW MILK") {
    currentProduct = "COW";
    basePrice = 48;
    document.getElementById('detail-price').textContent = "Price: ₹55/L";
    document.getElementById('product-description').innerHTML = `
• Pure and fresh cow milk collected daily from trusted farms to ensure natural taste and high quality.<br><br>
• Rich in protein, calcium, vitamins, and essential nutrients that support a healthy and balanced lifestyle.<br><br>
• Light, easy to digest, and suitable for daily consumption for children, adults, and elderly family members.<br><br>
• Ideal for tea, coffee, milkshakes, breakfast, and homemade dairy products with natural farm freshness.
`;
  }
  else if (name === "RAW BUFFALO MILK") {
    currentProduct = "BUFFALO";
    basePrice = 72;
    document.getElementById('detail-price').textContent = "Price: ₹80/L";
    document.getElementById('product-description').innerHTML = `
• Fresh raw buffalo milk sourced directly from healthy farm buffaloes with no added preservatives or chemicals.<br><br>
• Naturally rich in calcium, protein, and healthy fats that help support strong bones, energy, and daily nutrition.<br><br>
• Thick creamy texture and authentic taste make it perfect for tea, coffee, sweets, curd, and traditional dairy recipes.<br><br>
• Hygienically collected and carefully delivered fresh to maintain purity, freshness, and farm-to-home quality.
`;
  }
  else if (name === "BUFFALO BILONA CHAACH") {
    currentProduct = "CHAACH";
    basePrice = 36;
    document.getElementById('detail-price').textContent = "Price: ₹42/L";
    document.getElementById('product-description').innerHTML = `
• Traditional bilona chaach prepared using authentic methods for a naturally refreshing and healthy drink.<br><br>
• Helps improve digestion, keeps the body cool, and provides natural hydration during daily routines.<br><br>
• Rich creamy taste with balanced texture makes it a perfect healthy refreshment for every meal.<br><br>
• Prepared hygienically from fresh curd without artificial flavors or preservatives for authentic homemade quality.
`;
  }
  else if (name === "COW BILONA CHAACH") {
    currentProduct = "COW_CHAACH";
    basePrice = 30;
    document.getElementById('detail-price').textContent = "Price: ₹35/L";
    document.getElementById('product-description').innerHTML = `
• Fresh and light bilona chaach made from pure cow curd using traditional preparation techniques.<br><br>
• Supports healthy digestion, gut health, and natural body cooling with refreshing taste and nutrition.<br><br>
• Smooth texture and authentic flavor make it perfect for summer refreshment and daily healthy consumption.<br><br>
• Carefully prepared and packed hygienically to maintain freshness, purity, and traditional homemade goodness.
`;
  }
  else if (name === "DAHI") {
    currentProduct = "DAHI";
    basePrice = 72;
    document.getElementById('detail-price').textContent = "Price: ₹72/500g";
    document.getElementById('product-description').innerHTML = `
• Fresh homemade-style dahi prepared from pure milk with thick texture and natural creamy taste.<br><br>
• Rich in probiotics and nutrients that help improve digestion, gut health, and daily nutrition.<br><br>
• Smooth consistency and refreshing flavor make it perfect for meals, raita, lassi, and healthy snacks.<br><br>
• Hygienically prepared and packed fresh to maintain purity, freshness, and authentic homemade quality.
`;
  }
  else if (name === "PANEER") {
    currentProduct = "PANEER";
    basePrice = 450;
    document.getElementById('detail-price').textContent = "Price: ₹450/Kg";
    document.getElementById('product-description').innerHTML = `
• Soft and fresh paneer prepared from pure milk with rich texture and authentic taste.<br><br>
• High in protein and calcium, making it a healthy choice for balanced meals and daily nutrition.<br><br>
• Perfect for curries, snacks, salads, sandwiches, and a variety of homemade dishes.<br><br>
• Freshly prepared under hygienic conditions to ensure softness, freshness, and premium quality.
`;
  }
  else if (name.includes("GHEE")) {
    currentProduct = "GHEE";

    if (name === "BUFFALO GHEE") {
      basePrice = 1300;
      document.getElementById('product-description').innerHTML = `
• Pure buffalo ghee prepared using traditional methods to preserve authentic aroma, richness, and nutrition.<br><br>
• Rich in healthy fats and natural energy that enhance the taste and nutrition of everyday meals.<br><br>
• Thick texture and strong flavor make it ideal for cooking, sweets, rotis, and traditional Indian dishes.<br><br>
• Carefully processed from quality milk under hygienic conditions to ensure purity and premium quality.
`;
    }
    else if (name === "COW GHEE") {
      basePrice = 1100;
      document.getElementById('product-description').innerHTML = `
• Traditional cow ghee made from pure milk with rich aroma, authentic flavor, and natural nutrition.<br><br>
• Contains healthy fats and essential nutrients that support energy, digestion, and balanced daily diet.<br><br>
• Perfect for cooking, frying, sweets, and adding traditional taste to homemade meals and recipes.<br><br>
• Hygienically prepared to maintain freshness, purity, and premium quality in every spoon.
`;
    }
    else if (name === "RAW A2 COW GHEE") {
      basePrice = 2800;
      document.getElementById('product-description').innerHTML = `
• Premium bilona A2 cow ghee prepared from A2 milk of indigenous cows using traditional techniques.<br><br>
• Known for its rich nutrition, authentic aroma, and natural Ayurvedic benefits for healthy living.<br><br>
• Contains healthy fats and essential nutrients that support digestion, immunity, and daily wellness.<br><br>
• Carefully crafted in hygienic conditions to preserve purity, freshness, and superior traditional quality.
`;
    }

    document.getElementById('detail-price').textContent = `Price: ₹${basePrice}/Kg`;
  }

  detailQuantitySelect.innerHTML = `
    <option value="0.5">500 ml</option>
    <option value="1">1 L</option>
  `;

  if (name === "PANEER") {
    detailQuantitySelect.innerHTML = `
      <option value="0.1">100 g</option>
      <option value="0.5">500 g</option>
      <option value="1">1 Kg</option>
    `;
  }
  else if (name === "DAHI") {
    detailQuantitySelect.innerHTML = `
      <option value="0.25">250 g</option>
      <option value="0.5">500 g</option>
      <option value="1">1 Kg</option>
    `;
  }
  else if (name.includes("GHEE")) {
    detailQuantitySelect.innerHTML = `
      <option value="0.5">500 g</option>
      <option value="1">1 Kg</option>
    `;
  }

  if (catalog) {
    basePrice = catalog.defaultPrice || basePrice;
    if (catalog.displayPriceText) {
      document.getElementById('detail-price').textContent =
        `Price: ${catalog.displayPriceText}`;
    }
  }

  updatePlanOptionsForProduct();
  updatePrice();
  setActiveScreen('productDetail');
  syncDetailWishlistButton();
}

function normalizeDetailQuantity(value) {
  const text = String(value || "").trim();
  const quantityMap = {
    "500ml": "0.5",
    "1L": "1",
    "100g": "0.1",
    "250g": "0.25",
    "500g": "0.5",
    "1Kg": "1"
  };

  return quantityMap[text] || text;
}

function openCartItemEditor(index) {
  const cart = JSON.parse(localStorage.getItem('cart')) || [];
  const item = cart[index];
  if (!item) return;

  const productCard = Array
    .from(document.querySelectorAll('#products-screen .product-card'))
    .find(card =>
      card.querySelector('h3')?.textContent.trim() === item.name
    );

  if (!productCard) return;

  editingCartIndex = index;
  clearTimeout(cartDetailsAutoReturnTimer);
  openProductDetailFromCard(productCard);
  document.getElementById('cart-btn').textContent = "Update Cart";

  const plan = String(item.plan || "").trim();
  if (plan && plan !== "Not selected") {
    const planButton = Array
      .from(document.querySelectorAll('.plan-pill'))
      .find(btn => btn.textContent.trim() === plan);

    if (planButton && planButton.style.display !== "none") {
      document.querySelectorAll('.plan-pill')
        .forEach(btn => btn.classList.remove('active'));
      planButton.classList.add('active');
      selectedPlanType = plan;
      activateDateBoxesForPlan(plan);
    }
  }

  const quantitySelectEl = document.getElementById('quantity-select');
  const quantity = normalizeDetailQuantity(item.quantity);
  if (quantity && quantity !== "Not selected") {
    quantitySelectEl.value = quantity;
  }

  document.getElementById('packet-count').textContent = item.packets || 1;
  count = Number(item.packets) || 1;

  const startInputEl = document.getElementById('start-date');
  const endInputEl = document.getElementById('end-date');
  startInputEl.value = item.start === "Not selected" ? "" : (item.start || "");
  endInputEl.value = item.end === "Not selected" ? "" : (item.end || "");

  const slotSelectEl = document.getElementById('slot-select');
  slotSelectEl.value = item.slot === "Not selected" ? "" : (item.slot || "");

  if (plan === "Customised") {
    generateCustomDateBlocks();
    applySelectedCustomDates(item.customDates);
  }

  updateProductDatePlaceholders();
  updatePrice();
  checkForm();
  scheduleCartDetailsAutoSave();
}

/* ================= PRODUCT CARD OPENING AND DETAIL SCREEN ENTRY =================
   Home featured cards and Products screen Subscribe buttons both open the same product detail screen.
   Product detail screen is where user chooses plan, quantity, dates, packets and slot.
*/
featuredCards.forEach(card => {

  card.addEventListener('click', () => {

    if (!isLoggedIn) {
      setActiveScreen("login");
      return;
    }

    const name = card.dataset.name;

    // 🔥 Find same product card from products section
    const productCards =
      document.querySelectorAll('#products-screen .product-card');

    productCards.forEach(product => {

      const productName =
        product.querySelector('h3').textContent;

      if (productName === name) {

        // 🔥 SAME SUBSCRIBE BUTTON CLICK TRIGGER
        product.querySelector('.buy-btn')?.click();
      }

    });

  });

});

const featuredList = document.querySelector('.featured-list');

featuredList?.addEventListener('click', (e) => {
  if (e.target.closest('.wishlist-heart')) return;

  const featuredCard = e.target.closest('.featured-card');
  if (!featuredCard) return;

  e.stopPropagation();

  if (!isLoggedIn) {
    setActiveScreen("login");
    return;
  }

  const name = featuredCard.dataset.name;
  const productCard = Array
    .from(document.querySelectorAll('#products-screen .product-card'))
    .find(product =>
      product.querySelector('h3')?.textContent.trim() === name
    );

  productCard?.querySelector('.buy-btn')?.click();
}, true);

document.getElementById('products-screen')?.addEventListener('click', (e) => {
  const subscribeButton = e.target.closest('.buy-btn');
  if (!subscribeButton) return;

  e.preventDefault();
  e.stopImmediatePropagation();

  if (!isLoggedIn) {
    setActiveScreen("login");
    return;
  }

  editingCartIndex = null;
  openProductDetailFromCard(subscribeButton.closest('.product-card'));
}, true);

subscribeBtns.forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();

    if (!isLoggedIn) {
  setActiveScreen("login");
  return;
}

    editingCartIndex = null;
    openProductDetailFromCard(btn.closest('.product-card'));
    return;

    const detailQuantitySelect = document.getElementById('quantity-select');
    const detailSlotSelect = document.getElementById('slot-select');
    const detailStartDate = document.getElementById('start-date');
    const detailEndDate = document.getElementById('end-date');
    const detailPacketCount = document.getElementById('packet-count');
    const detailCustomDatesWrap = document.getElementById('custom-dates-wrap');

    currentProduct = ""; // 🔥 RESET EVERY TIME
    // 🔥 RESET PRODUCT DETAIL SCREEN

selectedPlanType = "";

document.querySelectorAll('.plan-pill')
  .forEach(p => p.classList.remove('active'));

detailCustomDatesWrap.innerHTML = "";

detailStartDate.value = "";

detailEndDate.value = "";

detailEndDate.disabled = true;

detailSlotSelect.value = "";

detailQuantitySelect.selectedIndex = 0;

count = 1;

detailPacketCount.textContent = 1;

    document.querySelectorAll('.plan-pill').forEach(btn => {
  btn.classList.remove('active');
});

    const card = btn.closest('.product-card');
    if (!card) return;

    const name = card.querySelector('h3').textContent;
    const price = card.querySelector('strong').textContent;
    const image = setDetailProductImage(
      name,
      card.querySelector('img')?.getAttribute('src') || card.querySelector('img')?.src
    );

    // 🔥 set data in detail screen
    document.getElementById('detail-name').textContent = name;
    const cleanPrice = price.replace("Rs.", "").trim();

if (name === "RAW A2 COW MILK") {
  currentProduct = "A2";
  basePrice = 80;

  document.getElementById('detail-price').textContent = "Price: ₹85/L";
document.getElementById('product-description').innerHTML = `
• Premium quality A2 milk obtained from indigenous Sahiwal cows known for their naturally nutritious milk.<br><br>

• Contains A2 protein which is easier to digest and considered healthier compared to regular milk varieties.<br><br>

• Rich source of calcium, protein, and natural nutrients that help support immunity, digestion, and overall wellness.<br><br>

• Freshly collected and delivered with care to preserve purity, taste, and authentic farm freshness every day.
`;}

else if (name === "RAW COW MILK") {
  currentProduct = "COW";
  basePrice = 48;

  document.getElementById('detail-price').textContent = "Price: ₹55/L"; // default (you can change)
document.getElementById('product-description').innerHTML = `
• Pure and fresh cow milk collected daily from trusted farms to ensure natural taste and high quality.<br><br>

• Rich in protein, calcium, vitamins, and essential nutrients that support a healthy and balanced lifestyle.<br><br>

• Light, easy to digest, and suitable for daily consumption for children, adults, and elderly family members.<br><br>

• Ideal for tea, coffee, milkshakes, breakfast, and homemade dairy products with natural farm freshness.
`;}

else if (name === "RAW BUFFALO MILK") {
  currentProduct = "BUFFALO";
  basePrice = 72;

  document.getElementById('detail-price').textContent = "Price: ₹80/L"; // default (you can change)
document.getElementById('product-description').innerHTML = `
• Fresh raw buffalo milk sourced directly from healthy farm buffaloes with no added preservatives or chemicals.<br><br>

• Naturally rich in calcium, protein, and healthy fats that help support strong bones, energy, and daily nutrition.<br><br>

• Thick creamy texture and authentic taste make it perfect for tea, coffee, sweets, curd, and traditional dairy recipes.<br><br>

• Hygienically collected and carefully delivered fresh to maintain purity, freshness, and farm-to-home quality.
`;}

else if (name === "BUFFALO BILONA CHAACH") {
  currentProduct = "CHAACH";
  basePrice = 36;

  document.getElementById('detail-price').textContent = "Price: ₹42/L"; // default
document.getElementById('product-description').innerHTML = `
• Traditional bilona chaach prepared using authentic methods for a naturally refreshing and healthy drink.<br><br>

• Helps improve digestion, keeps the body cool, and provides natural hydration during daily routines.<br><br>

• Rich creamy taste with balanced texture makes it a perfect healthy refreshment for every meal.<br><br>

• Prepared hygienically from fresh curd without artificial flavors or preservatives for authentic homemade quality.
`;}

else if (name === "COW BILONA CHAACH") {
  currentProduct = "COW_CHAACH";
  basePrice = 30;

  document.getElementById('detail-price').textContent = "Price: ₹35/L"; // default
document.getElementById('product-description').innerHTML = `
• Fresh and light bilona chaach made from pure cow curd using traditional preparation techniques.<br><br>

• Supports healthy digestion, gut health, and natural body cooling with refreshing taste and nutrition.<br><br>

• Smooth texture and authentic flavor make it perfect for summer refreshment and daily healthy consumption.<br><br>

• Carefully prepared and packed hygienically to maintain freshness, purity, and traditional homemade goodness.
`;}

else if (name === "DAHI") {
  currentProduct = "DAHI";
  basePrice = 72;

  document.getElementById('detail-price').textContent = "Price: ₹72/500g";
document.getElementById('product-description').innerHTML = `
• Fresh homemade-style dahi prepared from pure milk with thick texture and natural creamy taste.<br><br>

• Rich in probiotics and nutrients that help improve digestion, gut health, and daily nutrition.<br><br>

• Smooth consistency and refreshing flavor make it perfect for meals, raita, lassi, and healthy snacks.<br><br>

• Hygienically prepared and packed fresh to maintain purity, freshness, and authentic homemade quality.
`;}

else if (name === "PANEER") {
  currentProduct = "PANEER";
  basePrice = 450;

  document.getElementById('detail-price').textContent = "Price: ₹450/Kg";
document.getElementById('product-description').innerHTML = `
• Soft and fresh paneer prepared from pure milk with rich texture and authentic taste.<br><br>

• High in protein and calcium, making it a healthy choice for balanced meals and daily nutrition.<br><br>

• Perfect for curries, snacks, salads, sandwiches, and a variety of homemade dishes.<br><br>

• Freshly prepared under hygienic conditions to ensure softness, freshness, and premium quality.
`;}

else if (name.includes("GHEE")) {
  currentProduct = "GHEE";

  if (name === "BUFFALO GHEE"){ basePrice = 1300;
    document.getElementById('product-description').innerHTML = `
• Pure buffalo ghee prepared using traditional methods to preserve authentic aroma, richness, and nutrition.<br><br>

• Rich in healthy fats and natural energy that enhance the taste and nutrition of everyday meals.<br><br>

• Thick texture and strong flavor make it ideal for cooking, sweets, rotis, and traditional Indian dishes.<br><br>

• Carefully processed from quality milk under hygienic conditions to ensure purity and premium quality.
`;
  }
  else if (name === "COW GHEE"){ basePrice = 1100;
    document.getElementById('product-description').innerHTML = `
• Traditional cow ghee made from pure milk with rich aroma, authentic flavor, and natural nutrition.<br><br>

• Contains healthy fats and essential nutrients that support energy, digestion, and balanced daily diet.<br><br>

• Perfect for cooking, frying, sweets, and adding traditional taste to homemade meals and recipes.<br><br>

• Hygienically prepared to maintain freshness, purity, and premium quality in every spoon.
`;
  }
  else if (name === "RAW A2 COW GHEE"){ basePrice = 2800;
    document.getElementById('product-description').innerHTML = `
• Premium bilona A2 cow ghee prepared from A2 milk of indigenous cows using traditional techniques.<br><br>

• Known for its rich nutrition, authentic aroma, and natural Ayurvedic benefits for healthy living.<br><br>

• Contains healthy fats and essential nutrients that support digestion, immunity, and daily wellness.<br><br>

• Carefully crafted in hygienic conditions to preserve purity, freshness, and superior traditional quality.
`;
  }

  document.getElementById('detail-price').textContent = `Price: ₹${basePrice}/Kg`;
}
updatePlanOptionsForProduct();
updatePrice();
    setDetailProductImage(name, image);
    const quantitySelect =
  detailQuantitySelect;

// 🔥 Default for milk & chaach
quantitySelect.innerHTML = `
  <option value="0.5">500 ml</option>
  <option value="1">1 L</option>
`;

// 🔥 For ghee, paneer, dahi
if (
  name.includes("GHEE") ||
  name === "PANEER" ||
  name === "DAHI"
) {

  if (name === "PANEER") {

  quantitySelect.innerHTML = `
    <option value="0.1">100 g</option>
    <option value="0.5">500 g</option>
    <option value="1">1 Kg</option>
  `;
}

else if (name === "DAHI") {

  quantitySelect.innerHTML = `
    <option value="0.25">250 g</option>
    <option value="0.5">500 g</option>
    <option value="1">1 Kg</option>
  `;
}

else if (name.includes("GHEE")) {

  quantitySelect.innerHTML = `
    <option value="0.5">500 g</option>
    <option value="1">1 Kg</option>
  `;
}
}

    // 🔥 go to detail screen
    updatePlanOptionsForProduct();
    setActiveScreen('productDetail');
    syncDetailWishlistButton();

  });
});
const planPills = document.querySelectorAll('.plan-pill');

const startInput = document.getElementById('start-date');
const endInput = document.getElementById('end-date');

function formatLocalDateInput(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function parseLocalDateInput(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
}

function getEndOfMonthOffset(date, monthOffset) {
  return new Date(date.getFullYear(), date.getMonth() + monthOffset + 1, 0);
}

function getSubscriptionDateLimits() {
  const today = getStartOfDay(new Date());
  const selectedPlan =
    selectedPlanType ||
    document.querySelector('.plan-pill.active')?.textContent.trim() ||
    "";
  const threeMonthWindowEnd = getEndOfMonthOffset(today, 2);
  const currentYearEnd = new Date(today.getFullYear(), 11, 31);
  const isCustomised = selectedPlan === "Customised";

  return {
    min: formatLocalDateInput(today),
    startMax: formatLocalDateInput(threeMonthWindowEnd),
    endMax: formatLocalDateInput(isCustomised ? threeMonthWindowEnd : currentYearEnd)
  };
}

function clampDateInputValue(input) {
  if (!input || !input.value) return;

  const { min, startMax, endMax } = getSubscriptionDateLimits();
  const inputMin = input.min || min;
  const inputMax = input.max || (input === startInput ? startMax : endMax);
  if (input.value < inputMin) input.value = inputMin;
  if (input.value > inputMax) input.value = inputMax;
}

function activateDateBoxesForPlan(planType) {
  if (!startInput || !endInput) return;

  startInput.disabled = false;
  endInput.disabled = planType !== "Customised";
  endInput.readOnly = planType !== "Customised";

  startInput.classList.remove('date-glow');
  endInput.classList.remove('date-glow');
  void startInput.offsetWidth;
  startInput.classList.add('date-glow');
  endInput.classList.add('date-glow');

  setTimeout(() => {
    startInput.classList.remove('date-glow');
    endInput.classList.remove('date-glow');
  }, 3000);
}

function applySubscriptionDateLimits() {
  const { min, startMax, endMax } = getSubscriptionDateLimits();

  if (startInput) {
    startInput.min = min;
    startInput.max = startMax;
    clampDateInputValue(startInput);
  }

  if (endInput) {
    endInput.min = startInput?.value || min;
    endInput.max = endMax;
    clampDateInputValue(endInput);
  }
}

function updateProductDatePlaceholders() {
  applySubscriptionDateLimits();
  const selectedPlan =
    selectedPlanType ||
    document.querySelector('.plan-pill.active')?.textContent.trim() ||
    "";
  const isOneTimeOnly = selectedPlan === "One Time Only";
  const dateRow = document.querySelector('.date-row');
  const startPlaceholder =
    document.querySelector('label[for="start-date"] .date-placeholder');
  const endPlaceholder =
    document.querySelector('label[for="end-date"] .date-placeholder');

  dateRow?.classList.toggle('one-time-date-row', isOneTimeOnly);
  if (startPlaceholder) {
    startPlaceholder.textContent = isOneTimeOnly ? "Chosen Date" : "Start Date";
  }
  if (endPlaceholder) {
    endPlaceholder.textContent = "End Date";
  }

  [
    document.getElementById('start-date'),
    document.getElementById('end-date')
  ].forEach(input => {
    const field = input?.closest('.date-field');
    if (!field) return;
    field.classList.toggle('has-value', Boolean(input.value));
    field.classList.toggle('is-disabled', Boolean(input.disabled));
  });
}

[startInput, endInput].forEach(input => {
  input?.addEventListener('input', updateProductDatePlaceholders);
  input?.addEventListener('change', updateProductDatePlaceholders);
});
updateProductDatePlaceholders();

planPills.forEach(btn => {
  btn.addEventListener('click', () => {
    // 🔥 CUSTOMISED PLAN
    // active toggle
    planPills.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // 🔥 REMOVE OLD CUSTOM BLOCKS
if (btn.textContent.trim() !== "Customised") {

  document.getElementById(
    'custom-dates-wrap'
  ).innerHTML = "";

}

    selectedPlanType = btn.textContent.trim();
    applySubscriptionDateLimits();

    // reset
    endInput.readOnly = true;
    startInput.classList.remove('date-glow');
    endInput.classList.remove('date-glow');

    void startInput.offsetWidth;

    if (selectedPlanType === "Customised") {
      // 🔥 both glow
      startInput.classList.add('date-glow');
      endInput.classList.add('date-glow');

      endInput.readOnly = false; // editable
    } else if (selectedPlanType === "One Time Only") {
      startInput.classList.add('date-glow');

      if (startInput.value) {
        endInput.value = startInput.value;
      }
    } else {
      // 🔥 only start glow
      startInput.classList.add('date-glow');
    }

    setTimeout(() => {
      startInput.classList.remove('date-glow');
      endInput.classList.remove('date-glow');
    }, 3000);

    updateEndDate(); // 🔥 auto calculation
    updateProductDatePlaceholders();
    updatePrice();
    checkForm();
  });
});

planPills.forEach(btn => {
  btn.addEventListener('click', () => {
    const planType = btn.textContent.trim();
    activateDateBoxesForPlan(planType);
    if (planType === "Customised") {
      generateCustomDateBlocks();
    }
    updateProductDatePlaceholders();
    checkForm();
    scheduleCartDetailsAutoSave();
  });
});

function updateEndDate() {

  if (!startInput.value) return;

  const start = parseLocalDateInput(startInput.value);
  if (!start) return;

  if (selectedPlanType === "One Time Only") {
    endInput.value = formatLocalDateInput(start);
    updateProductDatePlaceholders();
    return;
  }
  else if (selectedPlanType === "Monthly") {
    start.setMonth(start.getMonth() + 1);
    start.setDate(start.getDate() - 1);
  }
  else if (selectedPlanType === "15 Days") {
    start.setDate(start.getDate() + 14);
  }
  else if (selectedPlanType === "Weekly") {
    start.setDate(start.getDate() + 6);
  }
  else return;

  endInput.value = formatLocalDateInput(start);
  clampDateInputValue(endInput);
  updateProductDatePlaceholders();
}
function generateCustomDateBlocks() {
  applySubscriptionDateLimits();

  const wrap =
    document.getElementById('custom-dates-wrap');

  wrap.innerHTML = "";

  if (selectedPlanType !== "Customised") return;

  const start =
    parseLocalDateInput(startInput.value);

  const end =
    parseLocalDateInput(endInput.value);

  if (!start || !end)
    return;

  if (end < start) return;

  let current =
    new Date(start);

  while (current <= end) {

    const day =
      current.getDate();

    const month =
      current.toLocaleString('default', {
        month: 'short'
      });

    const fullDate =
      `${day} ${month}`;

    const block =
      document.createElement('button');

    block.className = "date-block";
    block.type = "button";
    block.dataset.date = formatLocalDateInput(current);

    block.textContent = fullDate;

    block.addEventListener('click', () => {
      block.classList.toggle('active');
    });

    wrap.appendChild(block);

    current.setDate(
      current.getDate() + 1
    );
  }
}

function getSelectedCustomDates() {
  return Array
    .from(document.querySelectorAll('#custom-dates-wrap .date-block.active'))
    .map(block => block.dataset.date)
    .filter(Boolean);
}

function applySelectedCustomDates(customDates = []) {
  const selectedDates = new Set(customDates || []);

  document
    .querySelectorAll('#custom-dates-wrap .date-block')
    .forEach(block => {
      block.classList.toggle('active', selectedDates.has(block.dataset.date));
    });
}
const countDisplay = document.getElementById('packet-count');

document.getElementById('plus').addEventListener('click', () => {
  count++;
  countDisplay.textContent = count;
});

document.getElementById('minus').addEventListener('click', () => {
  if (count > 1) {
    count--;
    countDisplay.textContent = count;
  }
});
const quantitySelect = document.getElementById('quantity-select');
const slotSelect = document.getElementById('slot-select');
const startDate = document.getElementById('start-date');
const endDate = document.getElementById('end-date');
const buyNowBtn = document.getElementById('buy-now-btn');

function checkForm() {
  applySubscriptionDateLimits();

  const quantity = quantitySelect.value;
  const slot = slotSelect.value;
  const start = startDate.value;
  const end = endDate.value;
  const selectedPlanBtn =
    document.querySelector('.plan-pill.active');
  const cartBtn = document.getElementById('cart-btn');
  const isFormComplete = Boolean(selectedPlanBtn && quantity && slot && start && end);

  if (isFormComplete) {
    buyNowBtn.disabled = false;
    buyNowBtn.style.background = "#7fcdf4";
  } else {
    buyNowBtn.disabled = true;
    buyNowBtn.style.background = "#dcdcdc";
  }

  if (cartBtn) {
    cartBtn.disabled = !isFormComplete;
    cartBtn.style.background = isFormComplete ? "#7fcdf4" : "#dcdcdc";
  }
}
quantitySelect.addEventListener('change', checkForm);
quantitySelect.addEventListener('change', updatePrice);
slotSelect.addEventListener('change', checkForm);
slotSelect.addEventListener('change', scheduleCartDetailsAutoSave);
startDate.addEventListener('change', () => {
  applySubscriptionDateLimits();

  let selectedPlanBtn =
    document.querySelector('.plan-pill.active');

  // 🔥 PLAN REQUIRED
  if (!selectedPlanBtn) {

    endDate.value = "";

    endDate.disabled = true;

  }

  else {

    const plan =
      selectedPlanBtn.textContent.trim();

    // 🔥 ONE TIME ONLY
    if (plan === "One Time Only") {

      endDate.value = startDate.value;

      endDate.disabled = true;

    }

    // 🔥 CUSTOMISED
    else if (plan === "Customised") {

      endDate.disabled = false;

      endDate.value = "";

    }

    // 🔥 WEEKLY
    else if (plan === "Weekly") {

      let start = parseLocalDateInput(startDate.value);
      if (!start) return;

      start.setDate(start.getDate() + 6);

      endDate.value =
        formatLocalDateInput(start);
      clampDateInputValue(endDate);

      endDate.disabled = true;

    }

    // 🔥 15 DAYS
    else if (plan === "15 Days") {

      let start = parseLocalDateInput(startDate.value);
      if (!start) return;

      start.setDate(start.getDate() + 14);

      endDate.value =
        formatLocalDateInput(start);
      clampDateInputValue(endDate);

      endDate.disabled = true;

    }

    // 🔥 MONTHLY
    else if (plan === "Monthly") {

      let start = parseLocalDateInput(startDate.value);
      if (!start) return;

      start.setMonth(start.getMonth() + 1);

      start.setDate(start.getDate() - 1);

      endDate.value =
        formatLocalDateInput(start);
      clampDateInputValue(endDate);

      endDate.disabled = true;

    }

  }

  updateProductDatePlaceholders();
  checkForm();
  if (selectedPlanBtn?.textContent.trim() === "Customised") {
    generateCustomDateBlocks();
  }
  scheduleCartDetailsAutoSave();

});
endDate.addEventListener('change', () => {
  applySubscriptionDateLimits();
  checkForm();
  if (document.querySelector('.plan-pill.active')?.textContent.trim() === "Customised") {
    generateCustomDateBlocks();
  }
  scheduleCartDetailsAutoSave();
});
endDate.addEventListener('change', () => {

  const selectedPlan =
    document.querySelector('.plan-pill.active');

  if (
    selectedPlan &&
    selectedPlan.textContent.trim() === "Customised"
  ) {

    generateCustomDateBlocks();

  }

});
buyNowBtn.addEventListener('click', () => {

  if (!isLoggedIn) {
    setActiveScreen("login");
    return;
  }

  const productName =
    document.getElementById('detail-name').textContent;

  const productPrice =
    getBasePrice(document.getElementById('detail-price').textContent);

  const productImage =
    document.getElementById('detail-image').src;

  const quantity =
    document.getElementById('quantity-select').value;

  const packets =
    document.getElementById('packet-count').textContent;

  const start =
    document.getElementById('start-date').value;

  const end =
    document.getElementById('end-date').value;

  const slot =
    document.getElementById('slot-select').value;

  let selectedPlanBtn =
    document.querySelector('.plan-pill.active');

  if (!selectedPlanBtn) return;

  let plan = selectedPlanBtn.textContent.trim();
  const customDates =
    plan === "Customised" ? getSelectedCustomDates() : [];

  const buyNowItem = {
    name: productName,
    price: productPrice,
    image: productImage,
    quantity,
    packets,
    start,
    end,
    slot,
    plan,
    customDates
  };

  localStorage.setItem(
    'buyNowItem',
    JSON.stringify(buyNowItem)
  );

  localStorage.setItem('checkoutMode', 'buyNow');
  setActiveScreen('cartAddress');

});

    

/* ================= ADD TO CART FROM PRODUCT DETAIL =================
   Reads selected product detail values and saves/updates cart.
   If user edited an existing cart item, it updates that item.
   If same product+quantity+slot+plan exists, packet count is increased instead of duplicate card.
*/
const cartBtnClick = document.getElementById('cart-btn');

cartBtnClick.addEventListener('click', () => {
  if (cartBtnClick.disabled) return;

  if (!isLoggedIn) {
  setActiveScreen("login");
  return;
}

  const productName = document.getElementById('detail-name').textContent;
  
const priceText =
  document.getElementById('detail-price')
  .textContent;

const productPrice = getBasePrice(priceText);

const productImage = document.getElementById('detail-image').src;
  const quantitySelectEl = document.getElementById('quantity-select');
  const slotSelectEl = document.getElementById('slot-select');
  const quantity = quantitySelectEl.value || quantitySelectEl.options[0]?.value || "Not selected";
  const packets = document.getElementById('packet-count').textContent;
  const start = document.getElementById('start-date').value || "Not selected";
  const end = document.getElementById('end-date').value || "Not selected";
  const slot = slotSelectEl.value || "Not selected";
  let selectedPlanBtn = document.querySelector('.plan-pill.active');

let plan = selectedPlanBtn?.textContent.trim() || "Not selected";
const customDates =
  plan === "Customised" ? getSelectedCustomDates() : [];


  const cartItem = {
    name: productName,
    price: productPrice,
    image: productImage,
    quantity,
    packets,
    start,
    end,
    slot,
    plan,
    customDates
  };

  let cart = JSON.parse(localStorage.getItem('cart')) || [];

if (editingCartIndex !== null && cart[editingCartIndex]) {
  if (
    completingCartDetailsIndex === editingCartIndex &&
    !isCartItemReadyForCheckout(cartItem)
  ) {
    showToast("Fill up all Details to Continue placing order");
    return;
  }

  const shouldReturnAfterCompletion =
    completingCartDetailsIndex === editingCartIndex;
  const returnDelay = cartDetailsAutoSaveInProgress ? 0 : 1000;

  cart[editingCartIndex] = cartItem;
  loadSelectedCartItems();
  selectedCartItems.add(editingCartIndex);
  mrSaveCart(cart);
  saveSelectedCartItems();
  renderDailyDeliveryCard();
  updateCartBadge();
  editingCartIndex = null;
  completingCartDetailsIndex = null;
  cartDetailsAutoSaveInProgress = false;
  clearTimeout(cartDetailsAutoReturnTimer);
  document.getElementById('cart-btn').textContent = "Add to Cart";
  if (shouldReturnAfterCompletion) {
    setTimeout(() => {
      setActiveScreen('orders');
      loadOrders();
    }, returnDelay);
  } else {
    setActiveScreen('orders');
    loadOrders();
  }
  return;
}

// 🔥 check if same product already exists
const existingIndex = cart.findIndex(item =>
  item.name === cartItem.name &&
  item.quantity === cartItem.quantity &&
  item.slot === cartItem.slot &&
  item.plan === cartItem.plan
);

// ? if exists → increase packets
if (existingIndex !== -1) {
  const existingItem = cart[existingIndex];
  existingItem.packets = Number(existingItem.packets) + Number(cartItem.packets);
  loadSelectedCartItems();
  selectedCartItems.add(existingIndex);
} else {
  // ? if different → create new card
  cart.push(cartItem);
  loadSelectedCartItems();
  selectedCartItems.add(cart.length - 1);
}

// save
mrSaveCart(cart);
saveSelectedCartItems();
renderDailyDeliveryCard();
updateCartBadge(); // 🔥 ADD THIS

  // success screen
  setActiveScreen('cartSuccess');

  setTimeout(() => {
    setActiveScreen('home');
  }, 1500);
});
cartBtnClick.addEventListener('click', () => {
  cartBtnClick.style.transform = "scale(0.35)";

  setTimeout(() => {
    cartBtnClick.style.transform = "scale(1)";
  }, 150);
});
const customPlanBanner = document.querySelector('.custom-plan-banner');

customPlanBanner.addEventListener('click', (e) => {
  e.stopPropagation();
  openPlanModal("customised");
});
function getBasePrice(priceStr) {
  const priceText = String(priceStr ?? "");
  const amountPart = priceText.split('/')[0];
  const match = amountPart.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function getCartItemDayCount(item) {
  if (!item) return 1;

  const selectedCustomDates = Array.isArray(item.customDates)
    ? item.customDates.filter(Boolean)
    : [];

  if (String(item.plan || "").trim() === "Customised" && selectedCustomDates.length > 0) {
    return selectedCustomDates.length;
  }

  const startDate = parseDeliveryDate(item.start);
  const endDate = parseDeliveryDate(item.end);
  if (!startDate || !endDate || endDate < startDate) return 1;

  return Math.max(
    1,
    Math.floor((getStartOfDay(endDate) - getStartOfDay(startDate)) / 86400000) + 1
  );
}

function getCartItemDailyTotal(item) {
  return getBasePrice(item?.price) * (Number(item?.packets) || 1);
}

function getCartItemPlanTotal(item) {
  return getCartItemDailyTotal(item) * getCartItemDayCount(item);
}

function getCartItemDayLabel(item) {
  const days = getCartItemDayCount(item);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function renderPlanPriceBreakdown(items = []) {
  if (!items.length) {
    return `<p class="price-breakdown-empty">Select products to see plan pricing.</p>`;
  }

  return `
    <div class="price-plan-breakdown">
      ${items.map(item => {
        const packets = Number(item.packets) || 1;
        const plan = item.plan || "Plan";
        const dayLabel = getCartItemDayLabel(item);
        const dailyTotal = getCartItemDailyTotal(item);
        const planTotal = getCartItemPlanTotal(item);

        return `
          <div class="price-plan-row">
            <div>
              <span>${item.name || "Product"}</span>
              <small>${plan} | ${packets} packet${packets === 1 ? "" : "s"} | ${formatPaymentCurrency(dailyTotal)} / day x ${dayLabel}</small>
            </div>
            <strong>${formatPaymentCurrency(planTotal)}</strong>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

let selectedCartItems = new Set();

function saveSelectedCartItems() {
  localStorage.setItem(
    'selectedCartItems',
    JSON.stringify([...selectedCartItems])
  );
  updateCartBadge();
}

function loadSelectedCartItems() {
  selectedCartItems = new Set(
    JSON.parse(localStorage.getItem('selectedCartItems')) || []
  );
}

function getSelectedCartTotal(cart) {
  let total = 0;

  selectedCartItems.forEach(index => {
    const item = cart[index];
    if (!item) return;

    total += getCartItemPlanTotal(item);
  });

  return total;
}

function hasSpecificCartValue(value) {
  const text = String(value || "").trim();
  return Boolean(text) && text !== "Not selected";
}

function isCartItemReadyForCheckout(item) {
  return Boolean(item) &&
    hasSpecificCartValue(item.plan) &&
    hasSpecificCartValue(item.start) &&
    hasSpecificCartValue(item.end) &&
    hasSpecificCartValue(item.slot);
}

function getFirstIncompleteSelectedCartIndex(cart) {
  return [...selectedCartItems]
    .map(Number)
    .find(index => cart[index] && !isCartItemReadyForCheckout(cart[index]));
}

function isDetailFormReadyForCheckout() {
  const selectedPlanBtn = document.querySelector('.plan-pill.active');
  return Boolean(
    selectedPlanBtn &&
    document.getElementById('start-date')?.value &&
    document.getElementById('end-date')?.value &&
    document.getElementById('slot-select')?.value
  );
}

function scheduleCartDetailsAutoSave() {
  clearTimeout(cartDetailsAutoReturnTimer);

  if (
    completingCartDetailsIndex === null ||
    editingCartIndex !== completingCartDetailsIndex ||
    !isDetailFormReadyForCheckout()
  ) {
    return;
  }

  cartDetailsAutoReturnTimer = setTimeout(() => {
    if (
      completingCartDetailsIndex !== null &&
      editingCartIndex === completingCartDetailsIndex &&
      isDetailFormReadyForCheckout()
    ) {
      cartDetailsAutoSaveInProgress = true;
      document.getElementById('cart-btn')?.click();
    }
  }, 1000);
}

function renderCartPricePanel(cart) {
  const panel =
    document.getElementById('cart-price-panel');

  if (!panel) return;

  if (cart.length === 0) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  panel.hidden = false;

  const selectedItems = getSelectedCartItems(cart);
  const selectedCount = selectedItems.length;
  const totalMrp = calculateOrderTotal(selectedItems);
  const platformFee = selectedCount > 0 ? 0 : 0;
  const totalAmount = totalMrp + platformFee;

  panel.innerHTML = `
    <div class="price-details-box">
      <h3>
        PRICE DETAILS (${selectedCount} Item${selectedCount === 1 ? "" : "s"})
      </h3>

      ${renderPlanPriceBreakdown(selectedItems)}

      <div class="price-line">
        <span>Total MRP</span>
        <strong>${formatPaymentCurrency(totalMrp)}</strong>
      </div>

      <div class="price-line">
        <span>Platform Fee</span>
        <strong>${platformFee === 0 ? "Free" : formatPaymentCurrency(platformFee)}</strong>
      </div>

      <div class="price-total-line">
        <span>Total Amount</span>
        <strong>${formatPaymentCurrency(totalAmount)}</strong>
      </div>

      <button
        type="button"
        class="place-order-btn"
        ${selectedCount === 0 ? "disabled" : ""}
      >
        PLACE ORDER
      </button>
    </div>
  `;

  panel
    .querySelector('.place-order-btn')
    ?.addEventListener('click', () => {
      if (selectedCartItems.size === 0) return;
      const incompleteIndex = getFirstIncompleteSelectedCartIndex(cart);
      if (incompleteIndex !== undefined) {
        showToast("Fill up all Details to Continue placing order");
        completingCartDetailsIndex = incompleteIndex;
        openCartItemEditor(incompleteIndex);
        return;
      }

      localStorage.setItem('checkoutMode', 'cart');
      localStorage.removeItem('buyNowItem');
      setActiveScreen('cartAddress');
    });
}

function getSelectedCartItems(cart) {
  return [...selectedCartItems]
    .map(index => cart[index])
    .filter(Boolean);
}

function getCheckoutMode() {
  return localStorage.getItem('checkoutMode') === 'buyNow' ? 'buyNow' : 'cart';
}

function getBuyNowItem() {
  try {
    return JSON.parse(localStorage.getItem('buyNowItem')) || null;
  } catch (error) {
    return null;
  }
}

function getCheckoutItems(cart = JSON.parse(localStorage.getItem('cart')) || []) {
  const buyNowItem = getBuyNowItem();
  if (getCheckoutMode() === 'buyNow' && buyNowItem) {
    return [buyNowItem];
  }

  return getSelectedCartItems(cart);
}

function getPlacedOrders() {
  return mrReadPlacedOrders();
}

function setPlacedOrders(orders) {
  mrSavePlacedOrders(orders || []);
}

function calculateOrderTotal(items = []) {
  return items.reduce(
    (sum, item) => {
      if (item.cancelled) return sum;
      return sum + getCartItemPlanTotal(item);
    },
    0
  );
}

function isCodOrder(orderOrPaymentMode) {
  const paymentMode = typeof orderOrPaymentMode === "string"
    ? orderOrPaymentMode
    : orderOrPaymentMode?.paymentMode;

  return String(paymentMode || "").toLowerCase().includes("cash on delivery");
}

function getOrderCodFee(order) {
  const hasActiveItems = (order.items || []).some(item => !item.cancelled);
  return isCodOrder(order) && hasActiveItems ? 10 : 0;
}

function calculateOrderPaidTotal(order) {
  return Math.max(
    0,
    calculateOrderTotal(order.items || []) + getOrderCodFee(order) - (Number(order?.milkCashUsed) || 0)
  );
}

async function mrNotifyAdminAboutOrder(order) {
  const sb = window.supabaseClient;
  if (!sb || !order?.id) return;

  try {
    const { error } = await sb.functions.invoke("send-order-whatsapp", {
      body: {
        order,
        customer: {
          name: localStorage.getItem("userName") || "",
          mobile: localStorage.getItem("userMobile") || "",
          email: localStorage.getItem("userEmail") || ""
        }
      }
    });

    if (error) console.log("Admin WhatsApp notification failed", error);
  } catch (error) {
    console.log("Admin WhatsApp notification failed", error);
  }
}

function completeSelectedCartOrder(paymentMode = "Cash On Delivery") {
  const cart = JSON.parse(localStorage.getItem('cart')) || [];
  loadSelectedCartItems();
  const checkoutMode = getCheckoutMode();

  const selectedIndexes = checkoutMode === 'buyNow'
    ? []
    : [...selectedCartItems]
      .map(Number)
      .filter(index => index >= 0 && index < cart.length);

  const selectedProducts = checkoutMode === 'buyNow'
    ? getCheckoutItems(cart)
    : selectedIndexes
      .map(index => cart[index])
      .filter(Boolean);

  if (selectedProducts.length === 0) return;

  const orderedAt = new Date().toISOString();
  const orderId = `MR${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
  const codFee = isCodOrder(paymentMode) ? 10 : 0;
  const milkCashUsed = getMilkCashDiscount();
  const totalAmount = Math.max(0, calculateOrderTotal(selectedProducts) - milkCashUsed) + codFee;
  const newOrder = {
    id: orderId,
    orderedAt,
    paymentMode,
    status: "Confirmed",
    codFee,
    milkCashUsed,
    totalAmount,
    items: selectedProducts.map(item => ({ ...item }))
  };

  const orders = getPlacedOrders();
  orders.unshift(newOrder);
  setPlacedOrders(orders);
  mrNotifyAdminAboutOrder(newOrder);

  if (milkCashUsed > 0) {
    addMilkCashTransaction({
      amount: -milkCashUsed,
      title: "Checkout Payment",
      note: `Used for order ${orderId}`,
      orderId
    });
  }

  const selectedIndexSet = new Set(selectedIndexes);
  const remainingCart = checkoutMode === 'buyNow'
    ? cart
    : cart.filter((_, index) => !selectedIndexSet.has(index));
  selectedCartItems = new Set();
  localStorage.removeItem('buyNowItem');
  localStorage.removeItem('checkoutMode');
  mrSaveCart(remainingCart);
  saveSelectedCartItems();
  updateCartBadge();
  loadOrders();
  renderProfileOrders();
  renderProfileSubscriptions();
}

function formatOrderDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function isOrderCancelWindowActive(order) {
  const orderedAt = new Date(order?.orderedAt);
  if (Number.isNaN(orderedAt.getTime())) return false;

  return Date.now() - orderedAt.getTime() <= 3 * 60 * 1000;
}

function renderProfileOrders() {
  const list = document.getElementById('profileOrdersList');
  if (!list) return;

  const orders = getPlacedOrders();

  if (orders.length === 0) {
    list.innerHTML = `
      <div class="profile-address-empty">
        No orders yet.
      </div>
    `;
    return;
  }

  list.innerHTML = orders.map(order => {
    const canCancelOrder = isOrderCancelWindowActive(order);

    return `
    <article class="profile-order-card">
      <div class="profile-order-head">
        <div>
          <h3>Order ${order.id}</h3>
          <p>${formatOrderDate(order.orderedAt)} | ${order.paymentMode}</p>
        </div>
        <span>${order.status || "Confirmed"}</span>
      </div>

      <div class="profile-order-items">
        ${(order.items || []).map((item, itemIndex) => `
          <div class="profile-order-item ${item.cancelled ? "cancelled" : ""}">
            <img src="${getCartProductImagePath(item)}" alt="">
            <div>
              <h4>${item.name || "Product"}</h4>
              <p>${item.quantity || "-"} | ${item.packets || 1} packet${Number(item.packets) === 1 ? "" : "s"}</p>
              <p>${item.plan || "-"} | ${item.slot || "-"}</p>
              <p>${getDeliveryDateRange(item)}</p>
              ${item.cancelled ? "" : `
                <div class="profile-order-actions">
                  <button
                    type="button"
                    data-profile-order-cancel="${order.id}"
                    data-profile-order-item="${itemIndex}"
                    ${canCancelOrder ? "" : "disabled"}
                  >
                    ${canCancelOrder ? "Cancel" : "Cancel closed"}
                  </button>
                </div>
              `}
            </div>
            <strong>${item.cancelled ? "Cancelled" : formatPaymentCurrency(getCartItemPlanTotal(item))}</strong>
          </div>
        `).join("")}
      </div>

      ${getOrderCodFee(order) ? `
        <div class="profile-order-total profile-order-fee">
          <span>Cash on Delivery Fee</span>
          <strong>${formatPaymentCurrency(getOrderCodFee(order))}</strong>
        </div>
      ` : ""}

      <div class="profile-order-total">
        <span>${isCodOrder(order) ? "Total" : "Total Paid"}</span>
        <strong>${formatPaymentCurrency(calculateOrderPaidTotal(order))}</strong>
      </div>
    </article>
  `}).join("");
}

function parseSubscriptionDate(value) {
  const parsed = parseLocalDateInput(value);
  if (parsed) return parsed;

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : getStartOfDay(fallback);
}

function getSubscriptionItems() {
  const subscriptionPlans = new Set(["Monthly", "Weekly", "15 Days", "Customised"]);
  return getPlacedOrders()
    .flatMap(order =>
      (order.items || []).map((item, itemIndex) => ({
        ...item,
        orderId: order.id,
        orderedAt: order.orderedAt,
        itemIndex
      }))
    )
    .filter(item =>
      subscriptionPlans.has(String(item.plan || "").trim()) &&
      !item.cancelled
    );
}

function getProfileSubscriptionDemoItem() {
  const startDate = getStartOfDay(new Date());
  startDate.setDate(startDate.getDate() - 1);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 14);
  const deliveredDateOne = new Date(startDate);
  const deliveredDateTwo = new Date(startDate);
  deliveredDateTwo.setDate(startDate.getDate() + 1);

  const demoItem = {
    isDemo: true,
    orderId: "demo-15-days-subscription",
    itemIndex: -1,
    name: "Raw Cow Milk",
    price: "₹70 / day",
    quantity: "1 Litre",
    packets: 1,
    plan: "15 Days",
    slot: "Morning",
    start: formatLocalDateInput(startDate),
    end: formatLocalDateInput(endDate),
    deliveredDates: [
      formatLocalDateInput(deliveredDateOne),
      formatLocalDateInput(deliveredDateTwo)
    ],
    image: "images/COW MILK.png"
  };

  try {
    const saved = JSON.parse(localStorage.getItem('deliveryControlsByProduct')) || {};
    const savedControls = saved[getDeliveryProductKey(demoItem)]?.controls;
    if (Array.isArray(savedControls)) demoItem.deliveryControls = savedControls;
  } catch (error) {
    demoItem.deliveryControls = [];
  }

  return demoItem;
}

function getSubscriptionStatus(item) {
  const today = getStartOfDay(new Date());
  const endDate = parseSubscriptionDate(item.end);
  if (!endDate) {
    return { expired: false, daysLeft: null, label: "Active" };
  }

  const daysLeft = Math.floor((endDate - today) / 86400000) + 1;
  return {
    expired: daysLeft <= 0,
    daysLeft: Math.max(daysLeft, 0),
    label: daysLeft <= 0 ? "Expired" : "Active"
  };
}

function getSubscriptionCalendarDates(item) {
  const start = parseSubscriptionDate(item.start);
  const end = parseSubscriptionDate(item.end);
  if (!start || !end || end < start) return [];

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function renderSubscriptionCalendar(item) {
  const dates = getSubscriptionCalendarDates(item);
  const deliveredDates = new Set(
    (item.deliveredDates || [])
      .map(value => {
        const parsed = parseSubscriptionDate(value);
        return parsed ? formatLocalDateInput(parsed) : "";
      })
      .filter(Boolean)
  );

  if (dates.length === 0) {
    return `
      <div class="subscription-calendar-box" aria-label="Subscription calendar">
        <p class="subscription-calendar-empty">Dates not selected</p>
      </div>
    `;
  }

  const start = formatDeliveryDate(item.start);
  const end = formatDeliveryDate(item.end);

  return `
    <div class="subscription-calendar-box" aria-label="Subscription calendar">
      <div class="subscription-calendar-head">
        <strong>${item.plan || "Subscription"} Calendar</strong>
        <span>${start} - ${end}</span>
      </div>
      <div class="subscription-calendar-grid">
        ${dates.map(date => {
          const delivered = deliveredDates.has(formatLocalDateInput(date));
          return `
            <span class="subscription-calendar-date ${delivered ? "delivered" : ""}">
              <small>${date.toLocaleDateString('en-IN', { weekday: 'short' })}</small>
              <strong>${date.getDate()}</strong>
              ${delivered ? '<b>✓</b>' : ''}
            </span>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderProfileSubscriptions(filter = "All") {
  const list = document.getElementById('profileSubscriptionsList');
  if (!list) return;

  document.querySelectorAll('.subscription-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subscriptionFilter === filter);
  });

  const subscriptions = [
    getProfileSubscriptionDemoItem(),
    ...getSubscriptionItems()
  ]
    .filter(item => filter === "All" || item.plan === filter);

  if (subscriptions.length === 0) {
    list.innerHTML = `
      <div class="profile-address-empty">
        No Subscriptions Made Yet
      </div>
    `;
    return;
  }

  list.innerHTML = subscriptions.map(item => {
    const status = getSubscriptionStatus(item);
    const daysText = status.daysLeft === null
      ? "End date not set"
      : status.expired
        ? "0 days left"
        : `${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left`;

    return `
      <article
        class="profile-subscription-card ${status.expired ? "expired" : ""} ${item.isDemo ? "demo" : ""}"
        data-subscription-order-id="${item.orderId}"
        data-subscription-item-index="${item.itemIndex}"
      >
        <img src="${getCartProductImagePath(item)}" alt="">
        <div class="profile-subscription-body">
          <div class="profile-subscription-head">
            <h3>${item.name || "Product"}</h3>
            <span class="subscription-status-pill ${status.expired ? "expired" : "active"}">${status.label}</span>
          </div>
          ${item.isDemo ? '<span class="subscription-demo-pill">Example Showcase</span>' : ''}
          <p>${item.quantity || "-"} | ${item.packets || 1} packet${Number(item.packets) === 1 ? "" : "s"}</p>
          <p>${item.plan || "-"} | ${item.slot || "-"}</p>
          <p>${getDeliveryDateRange(item)}</p>
        </div>
        <button class="subscription-days-pill" type="button" data-calendar-toggle>${daysText}</button>
        ${renderSubscriptionCalendar(item)}
      </article>
    `;
  }).join("");
}

document.querySelectorAll('.subscription-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    renderProfileSubscriptions(btn.dataset.subscriptionFilter || "All");
  });
});

document.getElementById('profileSubscriptionsList')?.addEventListener('click', (event) => {
  const calendarToggle = event.target.closest('[data-calendar-toggle]');
  if (calendarToggle) {
    event.stopPropagation();
    const card = calendarToggle.closest('.profile-subscription-card');
    card?.classList.toggle('calendar-open');
    return;
  }

  if (event.target.closest('.subscription-calendar-box')) {
    event.stopPropagation();
    return;
  }

  const card = event.target.closest('.profile-subscription-card');
  if (!card || card.classList.contains('expired')) return;

  if (card.dataset.subscriptionOrderId === "demo-15-days-subscription") {
    openDeliveryControls(getProfileSubscriptionDemoItem());
    return;
  }

  const orderId = card.dataset.subscriptionOrderId;
  const itemIndex = Number(card.dataset.subscriptionItemIndex);
  const order = getPlacedOrders().find(order => order.id === orderId);
  const item = order?.items?.[itemIndex];
  if (!item) return;

  openDeliveryControls({
    ...item,
    orderId,
    orderedAt: order.orderedAt,
    itemIndex
  });
});

function cancelProfileOrderItem(orderId, itemIndex) {
  let orders = getPlacedOrders();
  orders = orders.map(order => {
    if (order.id !== orderId) return order;

    const items = (order.items || []).map((item, index) =>
      index === itemIndex ? { ...item, cancelled: true, cancelledAt: new Date().toISOString() } : item
    );
    const activeItems = items.filter(item => !item.cancelled);

    return {
      ...order,
      items,
      status: activeItems.length ? order.status : "Cancelled",
      totalAmount: calculateOrderPaidTotal({ ...order, items })
    };
  });

  setPlacedOrders(orders);
  renderProfileOrders();
  renderProfileSubscriptions();
  renderDailyDeliveryCard();
}

function showOrderCancelModal(orderId, itemIndex) {
  const orders = getPlacedOrders();
  const order = orders.find(order => order.id === orderId);
  const product = order?.items?.[itemIndex];
  if (!product || product.cancelled) return;
  if (!isOrderCancelWindowActive(order)) return;

  pendingOrderCancel = { orderId, itemIndex };
  const message = document.getElementById('orderCancelMessage');
  if (message) {
    message.textContent = `Do you want to cancel ${product.name}?`;
  }
  document.getElementById('orderCancelModal')?.classList.add('active');
}

function hideOrderCancelModal() {
  pendingOrderCancel = null;
  document.getElementById('orderCancelModal')?.classList.remove('active');
}

function getDeliveryEstimateText() {
  const estimate = new Date();
  estimate.setDate(estimate.getDate() + 4);

  return estimate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function formatDeliveryDate(dateValue) {
  if (!dateValue) return "";

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function getDeliveryTimeWindow(slot) {
  const normalizedSlot = String(slot || "").toLowerCase();

  if (normalizedSlot === "morning") {
    return "7 a.m - 9 a.m";
  }

  if (normalizedSlot === "evening") {
    return "4 p.m - 7 p.m";
  }

  return "As per selected slot";
}

function getDeliveryDateRange(item) {
  const start = formatDeliveryDate(item.start);
  const end = formatDeliveryDate(item.end);

  if (!start && !end) return "";
  if (!end || start === end) return start;

  return `${start} - ${end}`;
}

function renderCartAddressSummary(cart) {
  const summary =
    document.getElementById('cartAddressSummary');

  if (!summary) return;

  const checkoutMode = getCheckoutMode();
  const selectedItems = getCheckoutItems(cart);
  const selectedCount = selectedItems.length;
  const totalMrp = calculateOrderTotal(selectedItems);
  const platformFee = selectedCount > 0 ? 0 : 0;
  const totalAmount = totalMrp + platformFee;

  summary.innerHTML = `
    ${checkoutMode === 'buyNow' && selectedItems[0] ? `
      <div class="buy-now-preview-box">
        <span>Buy Now</span>
        <div class="buy-now-preview-main">
          <img src="${getCartProductImagePath(selectedItems[0])}" alt="">
          <div>
            <h3>${selectedItems[0].name || "Product"}</h3>
            <p>${selectedItems[0].quantity || "-"} | ${selectedItems[0].packets || 1} packet${Number(selectedItems[0].packets) === 1 ? "" : "s"}</p>
            <p>${selectedItems[0].plan || "-"} | ${selectedItems[0].slot || "-"}</p>
          </div>
        <strong>${formatPaymentCurrency(totalMrp)}</strong>
        </div>
      </div>
    ` : ""}

    <div class="delivery-estimate-box">
      <h3>DELIVERY ESTIMATES</h3>
      ${selectedItems.length ? `
        <div class="delivery-estimate-list">
          ${selectedItems.map(item => `
            <div class="delivery-estimate-row">
              <img src="${getCartProductImagePath(item)}" alt="">
              <p>
                Estimated delivery between
                <strong>${getDeliveryTimeWindow(item.slot)}</strong>
                on
                <strong>${getDeliveryDateRange(item)}</strong>
              </p>
            </div>
          `).join("")}
        </div>
      ` : `
        <p class="muted-summary-text">Select items from your bag first.</p>
      `}
    </div>

    <div class="price-details-box address-price-box">
      <h3>
        PRICE DETAILS (${selectedCount} Item${selectedCount === 1 ? "" : "s"})
      </h3>

      ${renderPlanPriceBreakdown(selectedItems)}

      <div class="price-line">
        <span>Total MRP</span>
        <strong>${formatPaymentCurrency(totalMrp)}</strong>
      </div>

      <div class="price-line">
        <span>Platform Fee</span>
        <strong>${platformFee === 0 ? "Free" : formatPaymentCurrency(platformFee)}</strong>
      </div>

      <div class="price-total-line">
        <span>Total Amount</span>
        <strong>${formatPaymentCurrency(totalAmount)}</strong>
      </div>

      <button
        type="button"
        class="place-order-btn continue-to-payment"
        ${selectedCount === 0 ? "disabled" : ""}
      >
        CONTINUE
      </button>
    </div>
  `;

  const continueBtn = summary.querySelector('.continue-to-payment');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      if (getCheckoutItems(cart).length === 0) return;
      setActiveScreen('paymentMode');
    });
  }
}

function renderCartAddressPage() {
  const cart =
    JSON.parse(localStorage.getItem('cart')) || [];
  const checkoutMode = getCheckoutMode();

  loadSelectedCartItems();
  if (checkoutMode === 'cart') {
    selectedCartItems = new Set(
      [...selectedCartItems].filter(index => index < cart.length)
    );
    saveSelectedCartItems();
  }

  const list =
    document.getElementById('cartAddressList');

  if (!list) return;

  const addresses = getSavedAddresses();
  setSavedAddresses(addresses, { sync: false });

  const selectedAddressId =
    Number(localStorage.getItem('selectedDeliveryAddressId')) ||
    addresses[0]?.id;

  renderCartAddressSummary(cart);

  if (addresses.length === 0) {
    list.innerHTML = `
      <div class="cart-address-empty">
        No saved address yet.
      </div>
    `;
    return;
  }

  list.innerHTML = `
    <h3 class="address-group-title">DEFAULT ADDRESS</h3>
    ${addresses.map((address, index) => `
      ${index === 1 ? '<h3 class="address-group-title">OTHER ADDRESS</h3>' : ''}
      <article class="cart-address-card ${address.id === selectedAddressId ? "selected" : ""}">
        <label>
          <input
            type="radio"
            name="cartSelectedAddress"
            value="${address.id}"
            ${address.id === selectedAddressId ? "checked" : ""}
          >
          <span></span>
        </label>

        <div class="cart-address-info">
          <h3>
            ${address.name}
          </h3>

          <p>${address.house}, ${address.street}</p>
          <p>${address.town ? `${address.town}, ` : ""}${address.city}, ${address.state} - ${address.pin}</p>
          <p>Mobile: <strong>${address.mobile}</strong></p>

          <div class="address-actions">
            <button type="button" data-remove-address="${address.id}">REMOVE</button>
            <button type="button" data-edit-address="${address.id}">EDIT</button>
            ${renderAddressMapButton(address)}
          </div>
        </div>
      </article>
    `).join("")}
  `;

  document
    .querySelectorAll('[name="cartSelectedAddress"]')
    .forEach(radio => {
      radio.addEventListener('change', (e) => {
        localStorage.setItem(
          'selectedDeliveryAddressId',
          e.target.value
        );
        renderCartAddressPage();
      });
    });

  document
    .querySelectorAll('[data-remove-address]')
    .forEach(btn => {
      btn.addEventListener('click', () => {
        removeAddress(Number(btn.dataset.removeAddress));
        renderCartAddressPage();
      });
    });

  document
    .querySelectorAll('[data-edit-address]')
    .forEach(btn => {
      btn.addEventListener('click', () => {
        fillCartAddressForm(Number(btn.dataset.editAddress));
      });
    });
}

/* ================= CART / BAG SCREEN =================
   Renders cart cards, select-all checkbox, remove button, quantity updates,
   delivery details, and cart price panel.
*/
function loadOrders() {
  editingCartIndex = null;

  const container = document.getElementById('orders-container');
  container.innerHTML = "";

  const cart = JSON.parse(localStorage.getItem('cart')) || [];
  loadSelectedCartItems();

  selectedCartItems = new Set(
    [...selectedCartItems].filter(index => index < cart.length)
  );
  saveSelectedCartItems();
  renderCartPricePanel(cart);

  container.innerHTML = `
    <div class="cart-select-header">
      <label class="cart-check-wrap">
        <input
          type="checkbox"
          id="select-all-cart"
          ${cart.length > 0 && selectedCartItems.size === cart.length ? "checked" : ""}
        >
        <span></span>
      </label>

      <p>
        (${selectedCartItems.size}/${cart.length})
      </p>
    </div>
  `;

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="empty-cart-state">
        <p class="empty-cart-text">No items in Bag yet continue adding from Wishlist</p>
        <button
          type="button"
          class="empty-cart-wishlist-btn"
          aria-label="Open wishlist"
        >
          <span aria-hidden="true">&#9825;</span>
        </button>
      </div>
    `;

    container
      .querySelector('.empty-cart-wishlist-btn')
      ?.addEventListener('click', () => {
        previousScreen = "orders";
        setActiveScreen('wishlist');
      });
    return;
  }

  cart.forEach((item, index) => {
const dailyTotalPrice = getCartItemDailyTotal(item);

    const card = `
<div class="order-card" data-index="${index}">
  <label class="cart-check-wrap cart-item-check">
    <input
      type="checkbox"
      class="cart-card-checkbox"
      data-index="${index}"
      ${selectedCartItems.has(index) ? "checked" : ""}
    >
    <span></span>
  </label>

  <!-- remove -->
  <button class="remove-btn">✕</button>

  <!-- LEFT -->
  <div class="cart-left">
    <img src="${getCartProductImagePath(item)}" class="cart-product-img">

  </div>

  <!-- RIGHT -->
  <div class="cart-right">

    <h3 class="cart-title">
      ${item.name}
    </h3>

    <div class="cart-price">
      ${formatPaymentCurrency(dailyTotalPrice)} / day
    </div>

    <!-- size + qty row -->
    <div class="cart-select-row">

      <div class="cart-select-group">
        <span>Size:</span>

        <select class="size-select">

${item.name.includes("MILK") || item.name.includes("CHAACH") ? `

  <option value="500ml"
    ${item.quantity == "500ml" || item.quantity == "0.5" ? "selected" : ""}>
    500ml
  </option>

  <option value="1L"
    ${item.quantity == "1L" || item.quantity == "1" ? "selected" : ""}>
    1L
  </option>

` : ""}

${item.name.includes("GHEE") ? `

  <option value="500g"
    ${item.quantity == "500g" || item.quantity == "0.5" ? "selected" : ""}>
    500g
  </option>

  <option value="1Kg"
    ${item.quantity == "1Kg" || item.quantity == "1" ? "selected" : ""}>
    1Kg
  </option>

` : ""}

${item.name == "PANEER" ? `

  <option value="100g"
    ${item.quantity == "100g" || item.quantity == "0.1" ? "selected" : ""}>
    100g
  </option>

  <option value="500g"
    ${item.quantity == "500g" || item.quantity == "0.5" ? "selected" : ""}>
    500g
  </option>

  <option value="1Kg"
    ${item.quantity == "1Kg" || item.quantity == "1" ? "selected" : ""}>
    1Kg
  </option>

` : ""}

${item.name == "DAHI" ? `

  <option value="250g"
    ${item.quantity == "250g" || item.quantity == "0.25" ? "selected" : ""}>
    250g
  </option>

  <option value="500g"
    ${item.quantity == "500g" || item.quantity == "0.5" ? "selected" : ""}>
    500g
  </option>

  <option value="1Kg"
    ${item.quantity == "1Kg" || item.quantity == "1" ? "selected" : ""}>
    1Kg
  </option>

` : ""}

</select>
      </div>

      <div class="cart-select-group">
        <span>Qty:</span>

        <select class="qty-dropdown">
          <option ${item.packets == 1 ? 'selected' : ''}>1</option>
          <option ${item.packets == 2 ? 'selected' : ''}>2</option>
          <option ${item.packets == 3 ? 'selected' : ''}>3</option>
          <option ${item.packets == 4 ? 'selected' : ''}>4</option>
        </select>

      </div>

    </div>

    <div class="cart-detail">
      Plan: ${item.plan}
    </div>

    <div class="cart-detail">
      Start: ${item.start}
    </div>

    <div class="cart-detail">
      End: ${item.end}
    </div>

    <div class="cart-detail">
      Slot: ${item.slot}
    </div>

  </div>

</div>
`;
    container.innerHTML += card; // ? IMPORTANT
  });

  const selectAllCart =
    document.getElementById('select-all-cart');

  selectAllCart?.addEventListener('change', (e) => {
    if (e.target.checked) {
      selectedCartItems = new Set(cart.map((_, index) => index));
    } else {
      selectedCartItems.clear();
    }

    saveSelectedCartItems();
    loadOrders();
  });

  document.querySelectorAll('.cart-card-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const index = Number(e.target.dataset.index);

      if (e.target.checked) {
        selectedCartItems.add(index);
      } else {
        selectedCartItems.delete(index);
      }

      saveSelectedCartItems();
      loadOrders();
    });
  });

  // 🔥 REMOVE LOGIC (LOOP KE BAAD)
  document.querySelectorAll('.order-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (
        e.target.closest('label') ||
        e.target.closest('input') ||
        e.target.closest('select') ||
        e.target.closest('button')
      ) {
        return;
      }

      openCartItemEditor(Number(card.dataset.index));
    });
  });

  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {

      const card = e.target.closest('.order-card');
      const index = card.dataset.index;

      let cart = JSON.parse(localStorage.getItem('cart')) || [];

      cart.splice(index, 1);
      selectedCartItems = new Set(
        [...selectedCartItems]
          .filter(selectedIndex => selectedIndex !== Number(index))
          .map(selectedIndex =>
            selectedIndex > Number(index) ? selectedIndex - 1 : selectedIndex
          )
      );
      saveSelectedCartItems();

      mrSaveCart(cart);
      updateCartBadge();

      loadOrders();
    });
  });
  
// 🔥 SIZE CHANGE
document.querySelectorAll('.size-select').forEach(select => {

  select.addEventListener('change', (e) => {

    const card = e.target.closest('.order-card');

    const index = card.dataset.index;

    let cart =
      JSON.parse(localStorage.getItem('cart')) || [];

    const item = cart[index];

    const selectedSize = e.target.value;

    item.quantity = selectedSize;

    // 🔥 PRICE RECALCULATION

    // 🔥 RAW BUFFALO MILK
if (item.name === "RAW BUFFALO MILK") {

  if (item.plan === "Monthly") {
    item.price =
      selectedSize === "500ml" ? 36 : 72;
  }

  else if (item.plan === "15 Days") {
    item.price =
      selectedSize === "500ml" ? 36.5 : 73;
  }

  else if (item.plan === "Weekly") {
    item.price =
      selectedSize === "500ml" ? 37 : 74;
  }
    // fallback safety
  else {
    item.price =
      selectedSize === "500ml" ? 37.5 : 75;
  }

}

// 🔥 RAW COW MILK
else if (item.name === "RAW COW MILK") {

  if (item.plan === "Monthly") {
    item.price =
      selectedSize === "500ml" ? 24 : 48;
  }

  else if (item.plan === "15 Days") {
    item.price =
      selectedSize === "500ml" ? 24.5 : 49;
  }

  else if (item.plan === "Weekly") {
    item.price =
      selectedSize === "500ml" ? 25 : 50;
  }
   // fallback safety
  else {
    item.price =
      selectedSize === "500ml" ? 25.5 : 51;
  }

}

// 🔥 RAW A2 COW MILK
else if (item.name === "RAW A2 COW MILK") {

  if (item.plan === "Monthly") {
    item.price =
      selectedSize === "500ml" ? 40 : 80;
  }

  else if (item.plan === "15 Days") {
    item.price =
      selectedSize === "500ml" ? 40.5 : 81;
  }

  else if (item.plan === "Weekly") {
    item.price =
      selectedSize === "500ml" ? 41.5 : 83;
  }

  else {
    item.price =
      selectedSize === "500ml" ? 42.5 : 85;
  }

}

// 🔥 BUFFALO CHAACH
else if (item.name === "BUFFALO BILONA CHAACH") {

  if (item.plan === "Monthly") {
    item.price =
      selectedSize === "500ml" ? 18 : 36;
  }

  else if (item.plan === "15 Days") {
    item.price =
      selectedSize === "500ml" ? 18.5 : 37;
  }

  else if (item.plan === "Weekly") {
    item.price =
      selectedSize === "500ml" ? 19 : 38;
  }

  else {
    item.price =
      selectedSize === "500ml" ? 20 : 40;
  }

}

// 🔥 COW CHAACH
else if (item.name === "COW BILONA CHAACH") {

  if (item.plan === "Monthly") {
    item.price =
      selectedSize === "500ml" ? 15 : 30;
  }

  else if (item.plan === "15 Days") {
    item.price =
      selectedSize === "500ml" ? 15.5 : 31;
  }

  else if (item.plan === "Weekly") {
    item.price =
      selectedSize === "500ml" ? 16.5 : 33;
  }

  else {
    item.price =
      selectedSize === "500ml" ? 17.5 : 35;
  }

}

     // GHEE'S
    else if (item.name === "BUFFALO GHEE") {

      if (selectedSize === "500g") {
        item.price = 650;
      }

      else {
        item.price = 1300;
      }

    }
    else if (item.name === "COW GHEE") {

      if (selectedSize === "500g") {
        item.price = 550;
      }

      else {
        item.price = 1100;
      }

    }

    else if (item.name === "RAW A2 COW GHEE") {

      if (selectedSize === "500g") {
        item.price = 1400;
      }

      else {
        item.price = 2800;
      }

    }

    // PANEER
    else if (item.name === "PANEER") {

      if (selectedSize === "100g") {
        item.price = 45;
      }

      else if (selectedSize === "500g") {
        item.price = 225;
      }

      else {
        item.price = 450;
      }

    }

    // DAHI
    else if (item.name === "DAHI") {

      if (selectedSize === "250g") {
        item.price = 36;
      }

      else if (selectedSize === "500g") {
        item.price = 72;
      }

      else {
        item.price = 144;
      }

    }

    mrSaveCart(cart);

    updateCartBadge();

    loadOrders();

  });

});
// 🔥 QTY CHANGE
document.querySelectorAll('.qty-dropdown').forEach(select => {

  select.addEventListener('change', (e) => {

    const card =
      e.target.closest('.order-card');

    const index =
      card.dataset.index;

    let cart =
      JSON.parse(localStorage.getItem('cart')) || [];

    const item = cart[index];

    // 🔥 UPDATE QUANTITY
    item.packets =
      Number(e.target.value);

    mrSaveCart(cart);

    updateCartBadge();

    loadOrders();

  });

});

  
}
function updatePrice() {

  let pricePerLitre = 0;

  const selectedPlan = document.querySelector('.plan-pill.active');

  // 🔥 A2 LOGIC
  if (currentProduct === "A2") {

    pricePerLitre = 85;

    if (selectedPlan) {
      const plan = selectedPlan.textContent.trim();

      if (plan === "Weekly") pricePerLitre = 83;
      else if (plan === "15 Days") pricePerLitre = 81;
      else if (plan === "Monthly") pricePerLitre = 80;
    }
  }

  // 🔥 RAW COW MILK LOGIC
  else if (currentProduct === "COW") {

    pricePerLitre = 51;

    if (selectedPlan) {
      const plan = selectedPlan.textContent.trim();

      if (plan === "Weekly") pricePerLitre = 50;
      else if (plan === "15 Days") pricePerLitre = 49;
      else if (plan === "Monthly") pricePerLitre = 48;
    }
  }

  // 🔥 BUFFALO MILK LOGIC
else if (currentProduct === "BUFFALO") {

  pricePerLitre = 75; // default

  if (selectedPlan) {
    const plan = selectedPlan.textContent.trim();

    if (plan === "Weekly") pricePerLitre = 74;
    else if (plan === "15 Days") pricePerLitre = 73;
    else if (plan === "Monthly") pricePerLitre = 72;
  }
}

// 🔥 BUFFALO CHAACH LOGIC
else if (currentProduct === "CHAACH") {

  pricePerLitre = 40; // default

  if (selectedPlan) {
    const plan = selectedPlan.textContent.trim();

    if (plan === "Weekly") pricePerLitre = 38;
    else if (plan === "15 Days") pricePerLitre = 37;
    else if (plan === "Monthly") pricePerLitre = 36;
  }
}

// 🔥 COW CHAACH LOGIC
else if (currentProduct === "COW_CHAACH") {

  pricePerLitre = 35; // default

  if (selectedPlan) {
    const plan = selectedPlan.textContent.trim();

    if (plan === "Weekly") pricePerLitre = 33;
    else if (plan === "15 Days") pricePerLitre = 31;
    else if (plan === "Monthly") pricePerLitre = 30;
  }
}
// 🔥 GHEE
else if (currentProduct === "GHEE") {
  pricePerLitre = basePrice;
}

// 🔥 PANEER
else if (currentProduct === "PANEER") {

  const quantity =
    document.getElementById('quantity-select').value;

  if (quantity == "0.1") {
    pricePerLitre = 450;
  } else {
    pricePerLitre = basePrice;
  }
}

// 🔥 DAHI LOGIC
else if (currentProduct === "DAHI") {

  const quantity =
    document.getElementById('quantity-select').value;

  // 🔥 250g pricing
  if (quantity == "0.25") {

  // 🔥 250g equivalent pricing
  pricePerLitre = 144;

  if (selectedPlan) {

    const plan =
      selectedPlan.textContent.trim();

    if (plan === "Weekly")
      pricePerLitre = 140;

    else if (plan === "15 Days")
      pricePerLitre = 136;

    else if (plan === "Monthly")
      pricePerLitre = 130;
  }
}

  // 🔥 Existing pricing for bigger quantities
  else {

  // 🔥 1Kg equivalent pricing
  pricePerLitre = 144;

  if (selectedPlan) {

    const plan =
      selectedPlan.textContent.trim();

    if (plan === "Weekly")
      pricePerLitre = 140;

    else if (plan === "15 Days")
      pricePerLitre = 136;

    else if (plan === "Monthly")
      pricePerLitre = 130;
  }
}
}

  const catalogPlanPrice = getCatalogPlanPrice(
    currentProductName,
    document.querySelector('.plan-pill.active')?.textContent.trim()
  );
  if (catalogPlanPrice !== null) {
    pricePerLitre = catalogPlanPrice;
  }

  const quantity = document.getElementById('quantity-select').value;
  const qty = quantity ? Number(quantity) : 1;

  const finalPrice = pricePerLitre * qty;

  let unit = "L";

if (currentProduct === "GHEE" || currentProduct === "PANEER") {
  unit = "Kg";
}
else if (currentProduct === "DAHI") {
  unit = "500g";
}

let displayUnit = unit;

// 🔥 quantity based display
if (quantity == "0.1") {
  displayUnit = "100g";
}

else if (quantity == "0.25") {
  displayUnit = "250g";
}

else if (quantity == "0.5") {

  if (unit === "L") {
    displayUnit = "500ml";
  }

  else if (unit === "Kg") {
    displayUnit = "500g";
  }
}

document.getElementById('detail-price').textContent =
  `Price: ₹${finalPrice}/${displayUnit}`;
}

updateNavbar();
setupAppHeaderAutoReveal();
updateProfile();
markOneTimeProductCards();

function updateProfile() {
  const name = localStorage.getItem("userName");
  const mobile = localStorage.getItem("userMobile");
  const email = localStorage.getItem("userEmail");

  const nameEl = document.getElementById("profile-name");
  const mobileEl = document.getElementById("profile-mobile");

  if (nameEl) nameEl.textContent = name || "Name";
  if (mobileEl) mobileEl.textContent = mobile || email || "Mobile";
}
const hearts = document.querySelectorAll('.product-card .wishlist-heart');

hearts.forEach(heart => {
  heart.addEventListener('click', (e) => {
    e.stopPropagation(); // 🔥 product detail me na jaye


    const card = e.target.closest('.product-card');
    const name = card.querySelector('h3').textContent;
    const price = card.querySelector('strong').textContent;
    const image = normalizeAssetPath(card.querySelector('img')?.getAttribute('src') || card.querySelector('img')?.src);

    let wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];

    const existing = wishlist.find(item => item.name === name);

    if (existing) {
      // ? remove
      wishlist = wishlist.filter(item => item.name !== name);
      heart.classList.add('animate');
      setTimeout(() => heart.classList.remove('animate'), 400);
      heart.classList.remove('active');

      // 🔥 ADD THIS
      heart.classList.add('animate');
      setTimeout(() => heart.classList.remove('animate'), 400);

      showToast("Removed from Wishlist ❌"); // 🔥 ADD
    } else {
      // ? add
      let category = "";

if (name.includes("MILK")) category = "milk";
else if (name.includes("CHAACH")) category = "chaach";
else if (name.includes("GHEE")) category = "ghee";
else if (name === "DAHI") category = "dahi";
else if (name === "PANEER") category = "paneer";

wishlist.push({
  name,
  price,
  image,
  category
});
      heart.classList.add('active');

      // 🔥 ADD THIS
      heart.classList.add('animate');
      setTimeout(() => heart.classList.remove('animate'), 400);

      showToast("Added to Wishlist ✅"); // 🔥 ADD
    }

    mrSaveWishlist(wishlist);
    updateWishlistBadge(); // 🔥 ADD
    syncWishlistUI();
    updateCartBadge();
  });
});
/* ================= WISHLIST SCREEN AND HEART BUTTONS =================
   Keeps all product hearts in sync with local wishlist.
   Wishlist page can remove items or open the product detail screen again.
*/
function loadWishlistState() {
  const wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];

  document.querySelectorAll('.product-card').forEach(card => {
    const name = card.querySelector('h3').textContent;
    const heart = card.querySelector('.wishlist-heart');

    const exists = wishlist.find(item => item.name === name);

    if (exists) {
      heart.classList.add('active');
    }
  });
}

loadWishlistState();
updateWishlistBadge();
syncWishlistUI();
document.querySelectorAll('.featured-card').forEach(card => {
  const name = card.dataset.name;
  const heart = card.querySelector('.wishlist-heart');

  const wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];

  const exists = wishlist.find(item => item.name === name);

  if (exists && heart) {
    heart.classList.add('active');
  }
});
function loadWishlist() {

  const container = document.getElementById('wishlist-container');
  container.innerHTML = "";

  const wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];

  if (wishlist.length === 0) {
    container.innerHTML = `
      <div class="empty-wishlist-state">
        <p class="empty-wishlist-text">No items wishlisted yet Explore all products</p>
        <button
          type="button"
          class="empty-wishlist-products-btn"
          aria-label="Explore all products"
        >
          <span class="products-grid-icon" aria-hidden="true"></span>
        </button>
      </div>
    `;

    container
      .querySelector('.empty-wishlist-products-btn')
      ?.addEventListener('click', () => {
        setActiveScreen('products');
      });
    return;
  }

  wishlist.forEach(item => {

    const card = `
  <article class="product-card" data-category="${item.category}">
    
    <div class="product-visual">
      <img src="${normalizeAssetPath(item.image)}">
      <span class="wishlist-heart active">❤</span>
    </div>

    <div class="product-body">
      <h3>${item.name}</h3>

      <strong>${item.price}</strong>

      <button class="wishlist-cart-btn" data-product="${item.name}">
        ADD TO CART
      </button>
    </div>

  </article>
`;

    container.innerHTML += card;
  });
  document.querySelectorAll('#wishlist-container .wishlist-heart').forEach(heart => {
  heart.addEventListener('click', (e) => {

    const card = e.target.closest('.product-card');
    const name = card.querySelector('h3').textContent;

    let wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];

    wishlist = wishlist.filter(item => item.name !== name);

    mrSaveWishlist(wishlist);
    updateWishlistBadge(); // 🔥 ADD
    syncWishlistUI();

    showToast("Removed from Wishlist ❌"); // 🔥 ADD THIS


    loadWishlist(); // 🔥 reload
  });
});
  document.querySelectorAll('.wishlist-cart-btn').forEach(btn => {

  btn.addEventListener('click', (e) => {

    const productName = e.target.dataset.product;

    // 🔥 RAW COW MILK
    if (productName === "RAW COW MILK") {

      currentProduct = "COW";
      basePrice = 48;

      document.getElementById('detail-name').textContent = "RAW COW MILK";
      document.getElementById('detail-price').textContent = "Price: ₹51/L";
      setDetailProductImage(productName);
    }

    // 🔥 BUFFALO CHAACH
    else if (productName === "BUFFALO BILONA CHAACH") {

      currentProduct = "CHAACH";
      basePrice = 36;

      document.getElementById('detail-name').textContent = "BUFFALO BILONA CHAACH";
      document.getElementById('detail-price').textContent = "Price: ₹40/L";
      setDetailProductImage(productName);
    }

    // 🔥 DAHI
    else if (productName === "DAHI") {

      currentProduct = "DAHI";
      basePrice = 72;

      document.getElementById('detail-name').textContent = "DAHI";
      document.getElementById('detail-price').textContent = "Price: ₹72/500g";
      setDetailProductImage(productName);
    }

    // 🔥 A2 GHEE
    else if (productName === "RAW A2 COW GHEE") {

      currentProduct = "GHEE";
      basePrice = 1100;

      document.getElementById('detail-name').textContent = "RAW A2 COW GHEE";
      document.getElementById('detail-price').textContent = "Price: ₹1100/Kg";
      setDetailProductImage(productName);
    }
    // 🔥 SAVE WISHLIST SCREEN
    lastWishlistScreen = "wishlist";
    updatePlanOptionsForProduct();

    // 🔥 OPEN DETAIL SCREEN
    setActiveScreen('productDetail');
    syncDetailWishlistButton();

  });

});
};

const wishlistFilters = document.querySelectorAll('.wishlist-filter');

wishlistFilters.forEach(btn => {

  btn.addEventListener('click', () => {

    wishlistFilters.forEach(b =>
      b.classList.remove('active')
    );

    btn.classList.add('active');

    btn.scrollIntoView({
  behavior: "smooth",
  inline: "center"
});

    const selected = btn.dataset.wishlist.toLowerCase();

    document
      .querySelectorAll('#wishlist-container .product-card')
      .forEach(card => {

        const category = card.dataset.category?.toLowerCase();

        if (selected === "all" || category === selected) {
          card.style.display = "block";
        } else {
          card.style.display = "none";
        }

      });

  });

});
const featuredHearts = document.querySelectorAll('.featured-card .wishlist-heart');

featuredHearts.forEach(heart => {
  heart.addEventListener('click', (e) => {

    e.stopPropagation(); // 🔥 IMPORTANT (product open na ho)

    const card = e.target.closest('.featured-card');
    const name = card.dataset.name;
    const image = normalizeAssetPath(card.querySelector('img')?.getAttribute('src') || card.querySelector('img')?.src);

    let price = "";

    // 🔥 price mapping
    if (name.includes("MILK")) price = "₹50/L";
    else if (name.includes("CHAACH")) price = "₹40/L";
    else if (name.includes("GHEE")) price = "₹1100/Kg";
    else if (name === "DAHI") price = "₹72/500g";
    else if (name === "PANEER") price = "₹450/Kg";

    let wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];

    const exists = wishlist.find(item => item.name === name);

    if (exists) {
      wishlist = wishlist.filter(item => item.name !== name);
      heart.classList.remove('active');

      heart.classList.add('animate');
      setTimeout(() => heart.classList.remove('animate'), 400);
      showToast("Removed from Wishlist ❌"); // 🔥 ADD
    } else {
      let category = "";

if (name.includes("MILK")) category = "milk";
else if (name.includes("CHAACH")) category = "chaach";
else if (name.includes("GHEE")) category = "ghee";
else if (name === "DAHI") category = "dahi";
else if (name === "PANEER") category = "paneer";

wishlist.push({
  name,
  price,
  image,
  category
});
      heart.classList.add('active');
      heart.classList.add('animate');
      setTimeout(() => heart.classList.remove('animate'), 400);
      showToast("Added to Wishlist ✅"); // 🔥 ADD
    }

    mrSaveWishlist(wishlist);
    updateWishlistBadge();
    syncWishlistUI(); // 🔥 ADD THIS
  });
});
function showToast(message) {
  const toast = document.getElementById("toast");

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 1500);
}
function syncWishlistUI() {
  const wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];

  // 🔥 Product cards
  document.querySelectorAll('.product-card').forEach(card => {
    const name = card.querySelector('h3')?.textContent;
    const heart = card.querySelector('.wishlist-heart');

    if (!heart || !name) return;

    const exists = wishlist.find(item => item.name === name);

    heart.classList.toggle('active', !!exists);
  });

  // 🔥 Featured cards
  document.querySelectorAll('.featured-card').forEach(card => {
    const name = card.dataset.name;
    const heart = card.querySelector('.wishlist-heart');

    if (!heart || !name) return;

    const exists = wishlist.find(item => item.name === name);

    heart.classList.toggle('active', !!exists);
  });
}
/* ================= BADGES AND CROSS-TAB LOCAL UPDATES =================
   Bottom nav cart badge, wishlist badge, and localStorage changes from another tab.
*/
function updateWishlistBadge() {
  const wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];

  const badge1 = document.getElementById('wishlist-count');
  const badge2 = document.getElementById('wishlist-count-nav');

  if (badge1) badge1.textContent = wishlist.length;
  if (badge2) badge2.textContent = wishlist.length;
}
function updateCartBadge() {
  const cart = JSON.parse(localStorage.getItem('cart')) || [];
  const badge = document.getElementById('cart-count');
  if (!badge) return;

  const selected = new Set(
    JSON.parse(localStorage.getItem('selectedCartItems')) || []
  );
  const selectedCount = [...selected]
    .filter(index => Number(index) >= 0 && Number(index) < cart.length)
    .length;

  badge.textContent = selectedCount;
}

window.addEventListener('storage', updateCartBadge);
setInterval(updateCartBadge, 500);
setInterval(() => {
  if (getActiveScreenName() === 'home') {
    renderDailyDeliveryCard();
  }
  updateNotificationBadge();
  if (getActiveScreenName() === 'notifications') {
    renderNotifications();
  }
}, 1500);

/* 🔥 ANIMATED SEARCH PLACEHOLDER */

const searchWords = [
  "Search Milk",
  "Search Ghee",
  "Search Paneer",
  "Search Chaach",
  "Search Dahi"
];

const placeholder = document.getElementById("animated-placeholder");

let wordIndex = 0;
let charIndex = 0;
let isDeleting = false;

function typeEffect() {
  if (!placeholder) return;

  const currentWord = searchWords[wordIndex];

  if (!isDeleting) {
    placeholder.textContent =
      currentWord.substring(0, charIndex + 1);

    charIndex++;

    if (charIndex === currentWord.length) {
      isDeleting = true;

      setTimeout(typeEffect, 1200);
      return;
    }
  }

  else {

    placeholder.textContent =
      currentWord.substring(0, charIndex - 1);

    charIndex--;

    if (charIndex === 0) {
      isDeleting = false;

      wordIndex =
        (wordIndex + 1) % searchWords.length;
    }
  }

  setTimeout(typeEffect, isDeleting ? 60 : 120);
}

if (placeholder) typeEffect();
function syncDetailWishlistButton() {
  const detailWishlistBtn =
    document.getElementById('detail-wishlist-btn');

  if (!detailWishlistBtn) return;

  const name =
    document.getElementById('detail-name').textContent;

  const wishlist =
    JSON.parse(localStorage.getItem('wishlist')) || [];

  const exists =
    wishlist.find(item => item.name === name);

  if (exists) {
    detailWishlistBtn.innerHTML = "Wishlist ❤️";
  } else {
    detailWishlistBtn.innerHTML = "Wishlist ♡";
  }
}
updateCartBadge();
hydrateProductCatalogFromDatabase();
mrHydrateCartFromDatabase();
mrHydrateWishlistFromDatabase();
mrHydrateOrdersFromDatabase();
mrHydrateSavedUpisFromDatabase();
mrHydrateSavedAddressesFromDatabase();
mrStartRealtimeSync();
renderDailyDeliveryCard();
updateNotificationBadge();
/* ================= BUY-NOW CHECKOUT SCREEN =================
   Older/direct checkout screen for buy-now flow.
   Most cart checkout address/payment flow uses cartAddress/paymentMode screens,
   but this block still supports direct product checkout UI.
*/
function loadCheckout() {

  const container =
    document.getElementById('checkout-container');

  const item =
    JSON.parse(localStorage.getItem('buyNowItem'));

  if (!item) return;

  container.innerHTML = `

    <div class="checkout-product-card">

      <img src="${getCartProductImagePath(item)}">

      <div>

        <h3>${item.name}</h3>

        <p>${formatPaymentCurrency(getCartItemDailyTotal(item))} / day</p>

        <p>Total: ${formatPaymentCurrency(getCartItemPlanTotal(item))} for ${getCartItemDayLabel(item)}</p>

        <p>Plan: ${item.plan}</p>

        <p>Qty: ${item.packets}</p>

        <p>Slot: ${item.slot}</p>

      </div>

    </div>

  `;

  renderAddresses();
}
// =========================
// NAME VALIDATION
// =========================

document.getElementById("addressName")?.addEventListener("input", (e) => {
  let value = e.target.value.replace(/[^a-zA-Z\s]/g, "");
  value = value.replace(/\b\w/g, char => char.toUpperCase());
  e.target.value = value;
});

document.getElementById("addressMobile")?.addEventListener("input", (e) => {
  let value = e.target.value.replace(/\D/g, "");
  value = value.slice(0, 10);
  e.target.value = value;
});


renderAddresses();

/* ADDRESS SYSTEM */

const MAP_VERIFY_PREFIXES = [
  'address',
  'cartAddress',
  'profileAddress',
  'dcAddress'
];
const PILANI_MAP_CENTER = [28.3639, 75.5878];
let activeAddressMapPrefix = null;
let addressPickerMap = null;
let addressPickerMarker = null;
let selectedMapAddress = null;

function getAddressFormData(prefix) {
  const read = (field, fallback = "") =>
    document.getElementById(`${prefix}${field}`)?.value?.trim() || fallback;

  return {
    name: read('Name'),
    mobile: read('Mobile'),
    pin: read('Pincode', '333031'),
    house: read('House'),
    street: read('Street'),
    town: read('Town'),
    city: read('City', 'Pilani'),
    state: read('State', 'Rajasthan')
  };
}

function buildAddressSearchText(address) {
  return [
    address.house,
    address.street,
    address.town,
    address.city || 'Pilani',
    address.state || 'Rajasthan',
    address.pin || '333031',
    'India'
  ]
    .filter(Boolean)
    .join(', ');
}

function getAddressVerifyKey(prefix) {
  return `${prefix}MapVerifiedAddress`;
}

function getAddressPendingKey(prefix) {
  return `${prefix}MapPendingAddress`;
}

function getVerifiedAddressText(prefix) {
  return sessionStorage.getItem(getAddressVerifyKey(prefix)) || "";
}

function setVerifiedAddressText(prefix, text) {
  sessionStorage.setItem(getAddressVerifyKey(prefix), text);
}

function getPendingAddressText(prefix) {
  return sessionStorage.getItem(getAddressPendingKey(prefix)) || "";
}

function setPendingAddressText(prefix, text) {
  sessionStorage.setItem(getAddressPendingKey(prefix), text);
}

function clearAddressMapVerification(prefix) {
  sessionStorage.removeItem(getAddressVerifyKey(prefix));
  sessionStorage.removeItem(getAddressPendingKey(prefix));
}

function updateAddressMapNote(prefix, status = "idle") {
  const note = document.querySelector(`[data-address-map-note="${prefix}"]`);
  const mapBtn = document.querySelector(`[data-address-map-prefix="${prefix}"]`);

  const address = getAddressFormData(prefix);
  const addressText = buildAddressSearchText(address);
  const isReady =
    address.name &&
    address.mobile &&
    address.house &&
    address.street &&
    address.town;
  const isVerified =
    address.house &&
    address.street &&
    address.town &&
    getVerifiedAddressText(prefix) === addressText;

  mapBtn?.classList.toggle('glow', isReady && !isVerified);
  note?.classList.toggle('active', isReady && !isVerified);
  if (note) {
    note.textContent = "Select on the map for more exact information";
  }
}

function updateAllAddressMapNotes() {
  MAP_VERIFY_PREFIXES.forEach(prefix => updateAddressMapNote(prefix));
}

function openAddressMap(prefix) {
  const address = getAddressFormData(prefix);

  if (!address.house || !address.street || !address.town) {
    showToast("Tip: map se exact address auto-fill ho jayega");
  }

  openInAppAddressPicker(prefix);
}

function getAddressMapElements() {
  return {
    modal: document.getElementById('addressMapModal'),
    canvas: document.getElementById('addressMapCanvas'),
    selectedText: document.getElementById('addressMapSelectedText'),
    useBtn: document.getElementById('addressMapUseBtn')
  };
}

function openInAppAddressPicker(prefix) {
  const { modal, selectedText, useBtn } = getAddressMapElements();
  if (!modal || !window.L) {
    showToast("Map load nahi hua. Internet check karke retry karein");
    return;
  }

  activeAddressMapPrefix = prefix;
  selectedMapAddress = null;
  if (addressPickerMarker && addressPickerMap) {
    addressPickerMap.removeLayer(addressPickerMarker);
    addressPickerMarker = null;
  }
  modal.classList.add('active');
  if (selectedText) selectedText.textContent = "Map par exact delivery point tap karein...";
  if (useBtn) useBtn.disabled = true;

  setTimeout(() => {
    if (!addressPickerMap) {
      addressPickerMap = L.map('addressMapCanvas', {
        zoomControl: true,
        attributionControl: false
      }).setView(PILANI_MAP_CENTER, 15);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(addressPickerMap);

      addressPickerMap.on('click', event => {
        selectMapPoint(event.latlng.lat, event.latlng.lng);
      });
    }

    addressPickerMap.invalidateSize();
    addressPickerMap.setView(PILANI_MAP_CENTER, 15);
    pinTypedAddressOnMap(prefix);
  }, 80);
}

function closeInAppAddressPicker() {
  const { modal } = getAddressMapElements();
  modal?.classList.remove('active');
  activeAddressMapPrefix = null;
}

function getTownFromReverseAddress(address = {}) {
  return (
    address.neighbourhood ||
    address.suburb ||
    address.quarter ||
    address.residential ||
    address.hamlet ||
    address.village ||
    address.town ||
    address.city_district ||
    address.city ||
    "Pilani"
  );
}

function getStreetFromReverseAddress(address = {}) {
  return (
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.path ||
    address.suburb ||
    address.neighbourhood ||
    ""
  );
}

function getHouseFromReverseAddress(address = {}) {
  return [
    address.house_number,
    address.building,
    address.amenity,
    address.shop,
    address.office
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function pinTypedAddressOnMap(prefix) {
  const { selectedText, useBtn } = getAddressMapElements();
  const address = getAddressFormData(prefix);
  const typedAddress = buildAddressSearchText(address);

  if (selectedText) {
    selectedText.textContent =
      address.house || address.street || address.town
        ? "Typed address map par search ho raha hai..."
        : "Address fields blank hain. Map par exact location tap karein.";
  }
  if (useBtn) useBtn.disabled = true;

  if (!address.house && !address.street && !address.town) return;

  try {
    const searchUrl =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=75.50,28.44,75.68,28.29&q=${encodeURIComponent(typedAddress)}`;
    const response = await fetch(searchUrl, {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) throw new Error("Address search failed");

    const results = await response.json();
    const firstResult = results?.[0];

    if (!firstResult?.lat || !firstResult?.lon) {
      if (selectedText) {
        selectedText.textContent =
          "Typed address ka exact match nahi mila. Map par location tap karke pin set karein.";
      }
      return;
    }

    const lat = Number(firstResult.lat);
    const lon = Number(firstResult.lon);
    addressPickerMap?.setView([lat, lon], 18);
    await selectMapPoint(lat, lon, {
      message: "Typed address par pin set hai. Zarurat ho to pin drag/tap karke adjust karein."
    });
  } catch (error) {
    if (selectedText) {
      selectedText.textContent =
        "Typed address search nahi ho paya. Map par exact location tap karein.";
    }
  }
}

function placeAddressPickerMarker(lat, lon) {
  if (!addressPickerMap) return;

  if (!addressPickerMarker) {
    addressPickerMarker = L.marker([lat, lon], {
      draggable: true,
      autoPan: true
    }).addTo(addressPickerMap);

    addressPickerMarker.on('dragstart', () => {
      const { selectedText, useBtn } = getAddressMapElements();
      if (selectedText) selectedText.textContent = "Pin adjust ho raha hai...";
      if (useBtn) useBtn.disabled = true;
    });

    addressPickerMarker.on('dragend', event => {
      const position = event.target.getLatLng();
      selectMapPoint(position.lat, position.lng, {
        message: "Pin adjusted. Ye location use karne ke liye button dabayein."
      });
    });
  } else {
    addressPickerMarker.setLatLng([lat, lon]);
  }
}

async function selectMapPoint(lat, lon, { message = "" } = {}) {
  const { selectedText, useBtn } = getAddressMapElements();

  if (!addressPickerMap) return;

  placeAddressPickerMarker(lat, lon);

  if (selectedText) selectedText.textContent = message || "Address fetch ho raha hai...";
  if (useBtn) useBtn.disabled = true;

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&addressdetails=1`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) throw new Error("Reverse geocode failed");

    const data = await response.json();
    const reverseAddress = data.address || {};
    const displayParts = String(data.display_name || "")
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
    const filledAddress = {
      house: getHouseFromReverseAddress(reverseAddress) || displayParts[0] || "",
      street: getStreetFromReverseAddress(reverseAddress) || displayParts[1] || displayParts[0] || "",
      town: getTownFromReverseAddress(reverseAddress),
      pin: "333031",
      city: "Pilani",
      state: "Rajasthan",
      displayName: data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      lat,
      lon
    };

    selectedMapAddress = filledAddress;
    if (selectedText) selectedText.textContent = filledAddress.displayName;
    if (useBtn) useBtn.disabled = false;
  } catch (error) {
    selectedMapAddress = {
      house: "",
      street: "",
      town: "Pilani",
      pin: "333031",
      city: "Pilani",
      state: "Rajasthan",
      displayName: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      lat,
      lon
    };
    if (selectedText) {
      selectedText.textContent =
        "Address auto-fetch nahi hua. Pin save hoga, house/street manually complete kar sakte hain.";
    }
    if (useBtn) useBtn.disabled = false;
  }
}

function setInputValueIfFound(id, value, { overwrite = true } = {}) {
  const input = document.getElementById(id);
  if (!input || value === undefined || value === null) return;
  if (!overwrite && input.value.trim()) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function useSelectedMapLocation() {
  if (!activeAddressMapPrefix || !selectedMapAddress) {
    showToast("Please select location on map first");
    return;
  }

  const prefix = activeAddressMapPrefix;

  setInputValueIfFound(`${prefix}House`, selectedMapAddress.house, {
    overwrite: Boolean(selectedMapAddress.house)
  });
  setInputValueIfFound(`${prefix}Street`, selectedMapAddress.street, { overwrite: true });
  setInputValueIfFound(`${prefix}Town`, selectedMapAddress.town, { overwrite: true });
  setInputValueIfFound(`${prefix}Pincode`, "333031", { overwrite: true });
  setInputValueIfFound(`${prefix}City`, "Pilani", { overwrite: true });
  setInputValueIfFound(`${prefix}State`, "Rajasthan", { overwrite: true });

  const verifiedText = buildAddressSearchText(getAddressFormData(prefix));
  setVerifiedAddressText(prefix, verifiedText);
  sessionStorage.removeItem(getAddressPendingKey(prefix));
  updateAddressMapNote(prefix);
  closeInAppAddressPicker();
  showToast("Map se address auto-filled");
}

function ensureAddressMapVerified(prefix) {
  return true;
}

function resetAddressFormVerification(prefix) {
  clearAddressMapVerification(prefix);
  updateAddressMapNote(prefix);
}

function hydrateAddressFormVerification(prefix, address) {
  setVerifiedAddressText(prefix, buildAddressSearchText(address));
  updateAddressMapNote(prefix);
}

function renderAddressMapButton(address) {
  const url =
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(buildAddressSearchText(address))}`;
  return `
    <button type="button" class="address-map-btn" data-open-address-map="${url}" title="Open this address on map">📍</button>
  `;
}

const addressToggle =
  document.getElementById('addressToggle');

const addressFormWrap =
  document.getElementById('addressFormWrap');

document.getElementById('proceedCheckoutBtn')?.addEventListener('click', () => {
  const addresses = getSavedAddresses();
  if (addresses.length === 0) {
    showToast("Please add a delivery address first");
    addressFormWrap.classList.add('active');
    return;
  }
  setActiveScreen('paymentMode');
});

const saveAddressBtn =
  document.getElementById('saveAddressBtn');

const cancelAddressBtn =
  document.getElementById('cancelAddressBtn');

function clearCheckoutAddressForm() {
  [
    'addressName',
    'addressMobile',
    'addressHouse',
    'addressStreet',
    'addressTown'
  ].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });

  window.editingAddressId = null;
  resetAddressFormVerification('address');
}

function closeCheckoutAddressForm() {
  addressFormWrap.classList.remove('active');
  clearCheckoutAddressForm();
}

function saveCheckoutAddress() {
  const name =
    document.getElementById('addressName').value.trim();

  const mobile =
    document.getElementById('addressMobile').value.trim();

  const pin = '333031';

  const house =
    document.getElementById('addressHouse').value.trim();

  const street =
    document.getElementById('addressStreet').value.trim();

  const town =
    document.getElementById('addressTown').value.trim();

  const city = 'Pilani';

  const state = 'Rajasthan';

  if (!name || !mobile || !house || !street || !town) {
    alert("Please fill all required address details");
    return;
  }

  if (!ensureAddressMapVerified('address')) return;

  let addresses = getSavedAddresses();

  // EDIT MODE

  if(window.editingAddressId){
    const editingId = window.editingAddressId;

    addresses = addresses.map(item => {

      if(item.id === editingId){

        return {
          ...item,
          name,
          mobile,
          pin,
          house,
          street,
          town,
          city,
          state
        };
      }

      return item;
    });

    window.editingAddressId = null;
    localStorage.setItem('selectedDeliveryAddressId', editingId);

  } else {

    // NEW ADDRESS

    const id = Date.now();

    addresses.push({
      id,
      name,
      mobile,
      pin,
      house,
      street,
      town,
      city,
      state
    });

    localStorage.setItem('selectedDeliveryAddressId', id);

  }

  setSavedAddresses(addresses);

  addressFormWrap.classList.remove('active');
  clearCheckoutAddressForm();

  renderAddresses();
  renderProfileAddresses();
  renderCartAddressPage();
}
/* ================= CHECKOUT SAVED ADDRESSES =================
   Renders saved addresses inside checkout/address screens and handles edit/remove/select.
*/
function renderAddresses() {

  const container =
    document.getElementById('savedAddresses');

  if (!container) return;

  container.innerHTML = "";

  const addresses = getSavedAddresses();
  setSavedAddresses(addresses, { sync: false });

  if (addresses.length === 0) return;

  const selectedAddressId =
    Number(localStorage.getItem('selectedDeliveryAddressId')) ||
    addresses[0]?.id;

  container.innerHTML = `
    <h3 class="address-group-title">DEFAULT ADDRESS</h3>
    ${addresses.map((address, index) => `
      ${index === 1 ? '<h3 class="address-group-title">OTHER ADDRESS</h3>' : ''}
      <div class="saved-address-card ${address.id === selectedAddressId ? "active" : ""}">

        <div class="address-top">

          <input
            type="radio"
            name="selectedAddress"
            class="address-radio"
            value="${address.id}"
            ${address.id === selectedAddressId ? "checked" : ""}
          >

          <div class="address-info">

            <h3>
              ${address.name}
            </h3>

            <p>
              ${address.house}, ${address.street}
            </p>

            <p>
              ${address.town ? `${address.town}, ` : ""}${address.city}, ${address.state} - ${address.pin}
            </p>

            <p>
              Mobile:
              <strong>${address.mobile}</strong>
            </p>

            <div class="address-actions">

              <button type="button" data-checkout-remove-address="${address.id}">
                REMOVE
              </button>

              <button type="button" data-checkout-edit-address="${address.id}">
                EDIT
              </button>

              ${renderAddressMapButton(address)}

            </div>

          </div>

        </div>

      </div>

    `).join("")}
  `;

  container
    .querySelectorAll('[name="selectedAddress"]')
    .forEach(radio => {
      radio.addEventListener('change', (event) => {
        localStorage.setItem('selectedDeliveryAddressId', event.target.value);
        renderAddresses();
      });
  });
}
function removeAddress(id){

  let addresses = getSavedAddresses();

  addresses =
    addresses.filter(item => item.id !== id);

  setSavedAddresses(addresses);

  const selectedAddressId =
    Number(localStorage.getItem('selectedDeliveryAddressId'));

  if (selectedAddressId === id) {
    if (addresses[0]) {
      localStorage.setItem('selectedDeliveryAddressId', addresses[0].id);
    } else {
      localStorage.removeItem('selectedDeliveryAddressId');
    }
  }

  if (window.activeProfileAddressId === id) {
    window.activeProfileAddressId = addresses[0]?.id || null;
  }

  renderAddresses();
  renderProfileAddresses();
  renderCartAddressPage();
}
window.removeAddress = removeAddress;

function editAddress(id){

  const addresses = getSavedAddresses();

  const address =
    addresses.find(item => item.id === id);

  if(!address) return;

  // FORM OPEN
  addressFormWrap.classList.add('active');

  // PREFILL VALUES

  document.getElementById('addressName').value =
    address.name;

  document.getElementById('addressMobile').value =
    address.mobile;

  document.getElementById('addressHouse').value =
    address.house;

  document.getElementById('addressStreet').value =
    address.street;

  document.getElementById('addressTown').value =
    address.town;

  hydrateAddressFormVerification('address', address);

  // SAVE CURRENT EDITING ID

  window.editingAddressId = id;
}
window.editAddress = editAddress;

function getSavedCards() {
  const cards = JSON.parse(localStorage.getItem('savedCards')) || [];

  return cards.filter(card =>
    card &&
    card.id &&
    card.holder &&
    card.number &&
    card.expiry &&
    card.last4
  );
}

function setSavedCards(cards) {
  localStorage.setItem('savedCards', JSON.stringify(cards));
}

/* ================= SAVED CARDS / SAVED UPI / PROFILE ADDRESS MANAGEMENT =================
   Profile payment/address pages use these helpers.
   Cards are local-only placeholder behavior; UPI and addresses sync with Supabase through mrSave* helpers.
*/
function getSavedUpis() {
  return mrNormalizeSavedUpis(mrReadSavedUpis()).filter(upi =>
    upi &&
    upi.id &&
    upi.upiId &&
    /^[^\s@]+@[^\s@]+$/.test(upi.upiId)
  );
}

function setSavedUpis(upis, { sync = true } = {}) {
  mrSaveSavedUpis(mrNormalizeSavedUpis(upis), { sync });
}

function upsertSavedCard(cardData) {
  const number = (cardData.number || "").replace(/\D/g, "");
  const holder = (cardData.holder || "").trim();
  const expiry = (cardData.expiry || "").trim();

  if (!holder || !number || !expiry || !isValidLuhn(number)) return false;

  let cards = getSavedCards();
  const existing = cards.find(card => card.number === number);
  const brand = detectCardBrand(number);
  const card = {
    id: existing?.id || Date.now(),
    holder,
    number,
    expiry,
    brand,
    last4: number.slice(-4),
    label: (cardData.label || brand).trim() || brand
  };

  if (existing) {
    cards = cards.map(item => item.id === existing.id ? { ...item, ...card } : item);
  } else {
    cards.push(card);
  }

  setSavedCards(cards);
  window.activeProfileCardId = card.id;
  renderProfileCards();
  return true;
}

function upsertSavedUpi(upiData) {
  const upiId = (upiData.upiId || "").trim().replace(/\s/g, "");
  if (!/^[^\s@]+@[^\s@]+$/.test(upiId)) return false;

  let upis = getSavedUpis();
  const existing = upis.find(upi => upi.upiId.toLowerCase() === upiId.toLowerCase());
  const upi = {
    id: existing?.id || Date.now(),
    upiId,
    label: (upiData.label || "UPI Account").trim() || "UPI Account"
  };

  if (existing) {
    upis = upis.map(item => item.id === existing.id ? { ...item, ...upi } : item);
  } else {
    upis.push(upi);
  }

  setSavedUpis(upis);
  window.activeProfileUpiId = upi.id;
  renderProfileUpis();
  return true;
}

function saveCardFromCheckoutPayment() {
  const checkbox = document.getElementById('secureCardCheckbox');
  if (!checkbox?.checked) return false;

  return upsertSavedCard({
    holder: localStorage.getItem('userName') || "Card Holder",
    number: document.getElementById('paymentCardNumber')?.value || "",
    expiry: document.getElementById('paymentCardExpiry')?.value || "",
    label: detectCardBrand(
      (document.getElementById('paymentCardNumber')?.value || "").replace(/\D/g, "")
    )
  });
}

function getAddMoneyAmount() {
  const amount = Number(document.querySelector('.amount-input')?.value || 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function saveCardFromWalletPayment() {
  showToast("Wallet balance is updated by admin/subscription adjustments only");
  return false;
}

function saveUpiFromWalletPayment() {
  showToast("Wallet balance is updated by admin/subscription adjustments only");
  return false;
}

function clearProfileCardForm() {
  [
    'profileCardHolder',
    'profileCardNumber',
    'profileCardExpiry',
    'profileCardLabel'
  ].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });

  window.editingProfileCardId = null;
}

function toggleProfileCardForm() {
  const wrap = document.getElementById('profileCardFormWrap');
  if (!wrap) return;

  if (wrap.classList.contains('active')) {
    closeProfileCardForm();
  } else {
    clearProfileCardForm();
    wrap.classList.add('active');
  }
}

function closeProfileCardForm() {
  document
    .getElementById('profileCardFormWrap')
    ?.classList.remove('active');
  clearProfileCardForm();
}

function fillProfileCardForm(id) {
  const card = getSavedCards().find(item => item.id === id);
  if (!card) return;

  document
    .getElementById('profileCardFormWrap')
    ?.classList.add('active');

  document.getElementById('profileCardHolder').value = card.holder || "";
  document.getElementById('profileCardNumber').value =
    (card.number || "").replace(/(.{4})/g, "$1 ").trim();
  document.getElementById('profileCardExpiry').value = card.expiry || "";
  document.getElementById('profileCardLabel').value = card.label || "";

  window.editingProfileCardId = id;
}

function saveProfileCard() {
  const holder = document.getElementById('profileCardHolder').value.trim();
  const number = document.getElementById('profileCardNumber').value.trim();
  const expiry = document.getElementById('profileCardExpiry').value.trim();
  const label = document.getElementById('profileCardLabel').value.trim();
  const digits = number.replace(/\D/g, "");

  if (!holder || !number || !expiry) {
    alert("Please fill all required card details");
    return;
  }

  if (!isValidLuhn(digits)) {
    alert("Please enter a valid card number");
    return;
  }

  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) {
    alert("Please enter expiry in MM/YY format");
    return;
  }

  let cards = getSavedCards();
  const editingId = window.editingProfileCardId;
  const brand = detectCardBrand(digits);
  const card = {
    id: editingId || Date.now(),
    holder,
    number: digits,
    expiry,
    brand,
    last4: digits.slice(-4),
    label: label || brand
  };

  if (editingId) {
    cards = cards.map(item => item.id === editingId ? card : item);
    window.activeProfileCardId = editingId;
  } else {
    cards.push(card);
    window.activeProfileCardId = card.id;
  }

  setSavedCards(cards);
  closeProfileCardForm();
  renderProfileCards();
}

function removeSavedCard(id) {
  setSavedCards(getSavedCards().filter(card => card.id !== id));
  if (window.activeProfileCardId === id) {
    window.activeProfileCardId = null;
  }
  renderProfileCards();
}

function renderProfileCards() {
  const list = document.getElementById('profileCardList');
  if (!list) return;

  const cards = getSavedCards();
  setSavedCards(cards);

  if (cards.length === 0) {
    list.innerHTML = `
      <div class="profile-address-empty">
        No saved card yet.
      </div>
    `;
    return;
  }

  const activeId = window.activeProfileCardId || null;

  list.innerHTML = `
    <h3 class="profile-address-group-title">DEFAULT CARD</h3>
    ${cards.map((card, index) => `
      ${index === 1 ? '<h3 class="profile-address-group-title">OTHER CARDS</h3>' : ''}
      <article
        class="profile-address-card payment-profile-card ${card.id === activeId ? "expanded" : ""}"
        data-profile-card="${card.id}"
      >
        <div class="profile-address-card-body">
          <h3>${card.label || card.brand}</h3>
          <p>${card.brand} card ending with <strong>${card.last4}</strong></p>
          <p>Name: ${card.holder}</p>
          <p>Valid Thru: ${card.expiry}</p>
        </div>

        <div class="profile-address-actions">
          <button type="button" data-profile-edit-card="${card.id}">EDIT</button>
          <button type="button" data-profile-remove-card="${card.id}">REMOVE</button>
        </div>
      </article>
    `).join("")}
  `;
}

function clearProfileUpiForm() {
  ['profileUpiId', 'profileUpiLabel'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });

  window.editingProfileUpiId = null;
}

function toggleProfileUpiForm() {
  const wrap = document.getElementById('profileUpiFormWrap');
  if (!wrap) return;

  if (wrap.classList.contains('active')) {
    closeProfileUpiForm();
  } else {
    clearProfileUpiForm();
    wrap.classList.add('active');
  }
}

function closeProfileUpiForm() {
  document
    .getElementById('profileUpiFormWrap')
    ?.classList.remove('active');
  clearProfileUpiForm();
}

function fillProfileUpiForm(id) {
  const upi = getSavedUpis().find(item => item.id === id);
  if (!upi) return;

  document
    .getElementById('profileUpiFormWrap')
    ?.classList.add('active');

  document.getElementById('profileUpiId').value = upi.upiId || "";
  document.getElementById('profileUpiLabel').value = upi.label || "";

  window.editingProfileUpiId = id;
}

function saveProfileUpi() {
  const upiId = document.getElementById('profileUpiId').value.trim().replace(/\s/g, "");
  const label = document.getElementById('profileUpiLabel').value.trim();

  if (!/^[^\s@]+@[^\s@]+$/.test(upiId)) {
    alert("Please enter a valid UPI ID");
    return;
  }

  let upis = getSavedUpis();
  const editingId = window.editingProfileUpiId;
  const upi = {
    id: editingId || Date.now(),
    upiId,
    label: label || "UPI Account"
  };

  if (editingId) {
    upis = upis.map(item => item.id === editingId ? upi : item);
    window.activeProfileUpiId = editingId;
  } else {
    upis.push(upi);
    window.activeProfileUpiId = upi.id;
  }

  setSavedUpis(upis);
  closeProfileUpiForm();
  renderProfileUpis();
}

function removeSavedUpi(id) {
  setSavedUpis(getSavedUpis().filter(upi => upi.id !== id));
  if (window.activeProfileUpiId === id) {
    window.activeProfileUpiId = null;
  }
  renderProfileUpis();
}

function renderProfileUpis() {
  const list = document.getElementById('profileUpiList');
  if (!list) return;

  const upis = getSavedUpis();
  setSavedUpis(upis, { sync: false });

  if (upis.length === 0) {
    list.innerHTML = `
      <div class="profile-address-empty">
        No saved UPI yet.
      </div>
    `;
    return;
  }

  const activeId = window.activeProfileUpiId || null;

  list.innerHTML = `
    <h3 class="profile-address-group-title">DEFAULT UPI</h3>
    ${upis.map((upi, index) => `
      ${index === 1 ? '<h3 class="profile-address-group-title">OTHER UPI IDS</h3>' : ''}
      <article
        class="profile-address-card payment-profile-card ${upi.id === activeId ? "expanded" : ""}"
        data-profile-upi="${upi.id}"
      >
        <div class="profile-address-card-body">
          <h3>${upi.label}</h3>
          <p>UPI ID: <strong>${upi.upiId}</strong></p>
          <p>Use this saved UPI for faster payment reference.</p>
        </div>

        <div class="profile-address-actions">
          <button type="button" data-profile-edit-upi="${upi.id}">EDIT</button>
          <button type="button" data-profile-remove-upi="${upi.id}">REMOVE</button>
        </div>
      </article>
    `).join("")}
  `;
}

function clearProfileAddressForm() {
  [
    'profileAddressName',
    'profileAddressMobile',
    'profileAddressHouse',
    'profileAddressStreet',
    'profileAddressTown'
  ].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });

  window.editingProfileAddressId = null;
  resetAddressFormVerification('profileAddress');
}

function toggleProfileAddressForm() {
  const wrap = document.getElementById('profileAddressFormWrap');
  if (!wrap) return;

  if (wrap.classList.contains('active')) {
    closeProfileAddressForm();
  } else {
    clearProfileAddressForm();
    wrap.classList.add('active');
  }
}

function closeProfileAddressForm() {
  document
    .getElementById('profileAddressFormWrap')
    ?.classList.remove('active');
  clearProfileAddressForm();
}

function fillProfileAddressForm(id) {
  const address =
    getSavedAddresses().find(item => item.id === id);

  if (!address) return;

  document
    .getElementById('profileAddressFormWrap')
    ?.classList.add('active');

  document.getElementById('profileAddressName').value =
    address.name || "";
  document.getElementById('profileAddressMobile').value =
    address.mobile || "";
  document.getElementById('profileAddressHouse').value =
    address.house || "";
  document.getElementById('profileAddressStreet').value =
    address.street || "";
  document.getElementById('profileAddressTown').value =
    address.town || "";

  hydrateAddressFormVerification('profileAddress', address);

  window.editingProfileAddressId = id;
}

function saveProfileAddress() {
  const name =
    document.getElementById('profileAddressName').value.trim();
  const mobile =
    document.getElementById('profileAddressMobile').value.trim();
  const pin = '333031';
  const house =
    document.getElementById('profileAddressHouse').value.trim();
  const street =
    document.getElementById('profileAddressStreet').value.trim();
  const town =
    document.getElementById('profileAddressTown').value.trim();
  const city = 'Pilani';
  const state = 'Rajasthan';

  if (!name || !mobile || !house || !street || !town) {
    alert("Please fill all required address details");
    return;
  }

  if (!ensureAddressMapVerified('profileAddress')) return;

  let addresses = getSavedAddresses();

  if (window.editingProfileAddressId) {
    const editingId = window.editingProfileAddressId;

    addresses = addresses.map(item => {
      if (item.id !== editingId) return item;

      return {
        ...item,
        name,
        mobile,
        pin,
        house,
        street,
        town,
        city,
        state
      };
    });

    localStorage.setItem('selectedDeliveryAddressId', editingId);
    window.activeProfileAddressId = editingId;
    window.editingProfileAddressId = null;
  } else {
    const id = Date.now();

    addresses.push({
      id,
      name,
      mobile,
      pin,
      house,
      street,
      town,
      city,
      state
    });

    localStorage.setItem('selectedDeliveryAddressId', id);
    window.activeProfileAddressId = id;
  }

  setSavedAddresses(addresses);
  closeProfileAddressForm();
  renderProfileAddresses();
  renderAddresses();
  renderCartAddressPage();
}

function renderProfileAddresses() {
  const list = document.getElementById('profileAddressList');
  if (!list) return;

  const addresses = getSavedAddresses();
  setSavedAddresses(addresses, { sync: false });

  if (addresses.length === 0) {
    list.innerHTML = `
      <div class="profile-address-empty">
        No saved address yet.
      </div>
    `;
    return;
  }

  const activeId = window.activeProfileAddressId || null;

  list.innerHTML = `
    <h3 class="profile-address-group-title">DEFAULT ADDRESS</h3>
    ${addresses.map((address, index) => `
      ${index === 1 ? '<h3 class="profile-address-group-title">OTHER ADDRESSES</h3>' : ''}
      <article
        class="profile-address-card ${address.id === activeId ? "expanded" : ""}"
        data-profile-address-card="${address.id}"
      >
        <div class="profile-address-card-body">
          <h3>${address.name}</h3>
          <p>${address.house}, ${address.street}</p>
          <p>${address.town}</p>
          <p>${address.city} - ${address.pin}</p>
          <p>${address.state}</p>
          <p>Mobile: <strong>${address.mobile}</strong></p>
          ${renderAddressMapButton(address)}
        </div>

        <div class="profile-address-actions">
          <button type="button" data-profile-edit-address="${address.id}">EDIT</button>
          <button type="button" data-profile-remove-address="${address.id}">REMOVE</button>
        </div>
      </article>
    `).join("")}
  `;
}

const cartAddAddressBtn =
  document.getElementById('cartAddAddressBtn');

const cartAddressFormWrap =
  document.getElementById('cartAddressFormWrap');

const cartCancelAddressBtn =
  document.getElementById('cartCancelAddressBtn');

const cartSaveAddressBtn =
  document.getElementById('cartSaveAddressBtn');

function clearCartAddressForm() {
  [
    'cartAddressName',
    'cartAddressMobile',
    'cartAddressHouse',
    'cartAddressStreet',
    'cartAddressTown'
  ].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = "";
  });

  window.editingCartAddressId = null;
  resetAddressFormVerification('cartAddress');
}

function fillCartAddressForm(id) {
  const addresses = getSavedAddresses();

  const address =
    addresses.find(item => item.id === id);

  if (!address) return;

  const wrap = document.getElementById('cartAddressFormWrap');
  if (wrap) wrap.classList.add('active');

  document.getElementById('cartAddressName').value =
    address.name || "";
  document.getElementById('cartAddressMobile').value =
    address.mobile || "";
  document.getElementById('cartAddressHouse').value =
    address.house || "";
  document.getElementById('cartAddressStreet').value =
    address.street || "";
  document.getElementById('cartAddressTown').value =
    address.town || "";

  hydrateAddressFormVerification('cartAddress', address);

  window.editingCartAddressId = id;
}

function closeCartAddressForm() {
  const wrap = document.getElementById('cartAddressFormWrap');
  if (wrap) wrap.classList.remove('active');
  clearCartAddressForm();
}

function saveCartAddress() {
  const name =
    document.getElementById('cartAddressName').value.trim();
  const mobile =
    document.getElementById('cartAddressMobile').value.trim();
  const pin = '333031';
  const house =
    document.getElementById('cartAddressHouse').value.trim();
  const street =
    document.getElementById('cartAddressStreet').value.trim();
  const town =
    document.getElementById('cartAddressTown').value.trim();
  const city = 'Pilani';
  const state = 'Rajasthan';

  if (!name || !mobile || !pin || !house || !street || !town || !city || !state) {
    alert("Please fill all required address details");
    return;
  }

  if (!ensureAddressMapVerified('cartAddress')) return;

  let addresses = getSavedAddresses();

  if (window.editingCartAddressId) {
    addresses = addresses.map(item => {
      if (item.id !== window.editingCartAddressId) return item;

      return {
        ...item,
        name,
        mobile,
        pin,
        house,
        street,
        town,
        city,
        state
      };
    });

    localStorage.setItem(
      'selectedDeliveryAddressId',
      window.editingCartAddressId
    );
  } else {
    const id = Date.now();

    addresses.push({
      id,
      name,
      mobile,
      pin,
      house,
      street,
      town,
      city,
      state
    });

    localStorage.setItem('selectedDeliveryAddressId', id);
  }

  setSavedAddresses(addresses);

  document.getElementById('cartAddressFormWrap')?.classList.remove('active');
  clearCartAddressForm();
  renderAddresses();
  renderCartAddressPage();
}

const dynamicBackBtn =
  document.getElementById("dynamic-back-btn");

dynamicBackBtn?.addEventListener("click", () => {

   const activeScreen =
      document.querySelector('.screen.active')
      ?.dataset.screen;

   // 🔥 IF PRODUCT PAGE OPEN
   if (activeScreen === "productDetail") {

      setActiveScreen(lastWishlistScreen || previousScreen);

      return;
   }

   // 🔥 NORMAL BACK
   setActiveScreen(previousScreen);

});

/* ================= PAYMENT MODE FINAL LOAD =================
   Refreshes payment mode total, MilkCash display, and final payment summary.
*/
function loadPaymentMode() {
  const cart = JSON.parse(localStorage.getItem('cart')) || [];
  const total = getSelectedCartTotal(cart);

  const milkCashBalance = getMilkCashBalance();
  const saved = Math.min(milkCashBalance, total);

  const balanceEl = document.getElementById('milkcash-balance');
  const savedEl = document.getElementById('milkcash-saved-amount');

  if (balanceEl) balanceEl.textContent = formatPaymentCurrency(milkCashBalance);
  if (savedEl) savedEl.textContent = formatPaymentCurrency(saved);

  ensureValidPaymentMethod();
  renderPaymentMode();
}
