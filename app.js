const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes, timingSafeEqual } = require("node:crypto");

function loadEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) return;
  const contents = fsSync.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[match[1]] = value;
  }
}

const BACKEND_DIR = __dirname;
loadEnvFile(path.resolve(BACKEND_DIR, ".env"));
loadEnvFile(path.resolve(BACKEND_DIR, "..", ".env"));

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ""
).trim();
const FRONTEND_ORIGINS = new Set(
  [
    ...(
      process.env.FRONTEND_ORIGINS ||
      "http://localhost:3000,http://127.0.0.1:3000,https://tiaramelanyy08-code.github.io"
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    process.env.RENDER_EXTERNAL_URL,
  ].filter(Boolean)
);
const FRONTEND_DIR = path.resolve(__dirname, "frontend");
const SESSION_COOKIE = "t_step_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const SHOE_TYPE_IDS = ["canvas", "suede", "white", "kids", "leather", "mesh", "other"];
const SHOE_TYPE_NAMES = {
  canvas: "Canvas",
  suede: "Suede",
  white: "Sepatu putih",
  kids: "Sepatu anak",
  leather: "Kulit",
  mesh: "Mesh / knit",
  other: "Lainnya",
};
const SHOE_PRICE_FACTORS = {
  canvas: 1,
  suede: 1.4,
  white: 1.2,
  kids: 0.85,
  leather: 1.5,
  mesh: 1.1,
  other: 1,
};
const ORDER_ITEMS_NOTE_PREFIX = "[[tstep-order-items:";
const DELIVERY_FEE = 5000;

function orderItemsNote(items, notes, logistics) {
  const encodedItems = Buffer.from(JSON.stringify({
    items,
    pickup_method: logistics.pickupMethod,
    return_method: logistics.returnMethod,
    delivery_fee: logistics.deliveryFee,
    late_delivery: Boolean(logistics.lateDelivery),
  }), "utf8").toString("base64url");
  return `${ORDER_ITEMS_NOTE_PREFIX}${encodedItems}]]${notes ? `\n${notes}` : ""}`;
}

function orderDetails(order) {
  const notes = typeof order.notes === "string" ? order.notes : "";
  const itemsMatch = notes.match(/^\[\[tstep-order-items:([A-Za-z0-9_-]+)\]\](?:\r?\n|$)/);
  if (itemsMatch) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(itemsMatch[1], "base64url").toString("utf8"));
    } catch {
      throw new Error(`Rincian sepatu pada pesanan ${order.order_number} tidak dapat dibaca.`);
    }
    const items = Array.isArray(payload) ? payload : payload?.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
      throw new Error(`Rincian sepatu pada pesanan ${order.order_number} tidak valid.`);
    }
    return {
      items,
      pickup_method: payload?.pickup_method || (order.delivery_type === "delivery" ? "home_pickup" : "store_dropoff"),
      return_method: payload?.return_method || (order.delivery_type === "delivery" ? "employee_delivery" : "self_pickup"),
      delivery_fee: Number(payload.delivery_fee) || 0,
      late_delivery: Boolean(payload?.late_delivery),
      notes: notes.replace(/^\[\[tstep-order-items:[A-Za-z0-9_-]+\]\](?:\r?\n|$)/, ""),
    };
  }

  const legacyMatch = notes.match(/^\[\[tstep-shoe-type:([A-Za-z0-9_-]+)\]\](?:\r?\n|$)/);
  const legacyShoeType = legacyMatch
    ? Buffer.from(legacyMatch[1], "base64url").toString("utf8").trim()
    : order.shoe_type;
  return {
    items: [{
      service_id: order.service_id,
      service_name: order.services?.name || "Laundry sepatu",
      shoe_type: legacyShoeType,
      shoe_brand: order.shoe_brand,
      shoe_size: order.shoe_size,
      price: Number(order.total_amount),
    }],
    pickup_method: order.delivery_type === "delivery" ? "home_pickup" : "store_dropoff",
    return_method: order.delivery_type === "delivery" ? "employee_delivery" : "self_pickup",
    delivery_fee: 0,
    late_delivery: false,
    notes: legacyMatch
      ? notes.replace(/^\[\[tstep-shoe-type:[A-Za-z0-9_-]+\]\](?:\r?\n|$)/, "")
      : notes,
  };
}

function publicOrder(order) {
  const details = orderDetails(order);
  return {
    ...order,
    items: details.items,
    pickup_method: details.pickup_method,
    return_method: details.return_method,
    delivery_fee: details.delivery_fee,
    late_delivery: details.late_delivery,
    shoe_type: details.items[0].shoe_type,
    notes: details.notes,
  };
}

const isProduction = process.env.NODE_ENV === "production";
const accounts = [
  {
    username: process.env.ADMIN_USERNAME || (isProduction ? "" : "admin@TStepLab.com"),
    password: process.env.ADMIN_PASSWORD || (isProduction ? "" : "admin123"),
    role: "admin",
  },
  {
    username: process.env.OWNER_USERNAME || (isProduction ? "" : "owner@TStepLab.com"),
    password: process.env.OWNER_PASSWORD || (isProduction ? "" : "owner123"),
    role: "owner",
  },
].filter((account) => account.username && account.password).reduce((result, account) => {
  result[account.username.toLowerCase()] = account;
  return result;
}, {});
const sessions = new Map();
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hasServerSupabaseKey() {
  if (SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_")) return false;
  if (SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_")) return true;
  if (!SUPABASE_SERVICE_ROLE_KEY.startsWith("eyJ")) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(SUPABASE_SERVICE_ROLE_KEY.split(".")[1], "base64url").toString("utf8")
    );
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

async function supabaseRequest(endpoint, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      ...(SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_")
        ? {}
        : { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }),
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Supabase mengirim respons yang tidak dapat dibaca.");
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || "Permintaan ke Supabase gagal.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function checkSupabaseConnection() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/services?select=id&limit=1`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        ...(SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_")
          ? {}
          : { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }),
      },
    });
    if (response.ok) {
      console.log("Supabase terhubung dan tabel services dapat diakses.");
    } else if (response.status === 401 || response.status === 403) {
      console.error("Supabase menolak key. Pastikan memakai Secret key atau service_role key yang benar.");
    } else if (response.status === 404) {
      console.error("Supabase dapat dijangkau, tetapi tabel services belum tersedia. Jalankan schema.sql.");
    } else {
      console.error(`Supabase dapat dijangkau, tetapi pemeriksaan tabel gagal (HTTP ${response.status}).`);
    }
    await response.body?.cancel();
  } catch {
    console.error("Tidak dapat menjangkau Supabase. Periksa URL dan koneksi internet.");
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function getSession(request) {
  const authorization = request.headers.authorization || "";
  const bearerToken = authorization.match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1];
  const cookies = request.headers.cookie || "";
  const cookieToken = cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const token = bearerToken || cookieToken;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function setSessionCookie(response, token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`
  );
}

function getSessionToken(request) {
  const authorization = request.headers.authorization || "";
  const bearerToken = authorization.match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1];
  if (bearerToken) return bearerToken;
  return (request.headers.cookie || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}

function passwordsMatch(input, expected) {
  const inputBuffer = Buffer.from(typeof input === "string" ? input : "");
  const expectedBuffer = Buffer.from(expected);
  return inputBuffer.length === expectedBuffer.length &&
    timingSafeEqual(inputBuffer, expectedBuffer);
}

function requireRole(session, method, pathname) {
  if (method === "GET") {
    if (session.role !== "owner" &&
      ["/api/dashboard", "/api/cashbook"].includes(pathname)) {
      throw new HttpError(403, "Data ini hanya dapat diakses oleh Owner.");
    }
    return;
  }
  const ownerActions = [
    ["POST", "/api/expenses"],
    ["POST", "/api/services"],
  ];
  const adminActions = [
    ["POST", "/api/orders"],
    ["POST", "/api/payments"],
  ];
  const isStatusUpdate = method === "PATCH" &&
    /^\/api\/orders\/[^/]+\/status$/.test(pathname);
  const isDeliveryRequest = method === "PATCH" &&
    /^\/api\/orders\/[^/]+\/delivery-request$/.test(pathname);
  const isServicePriceUpdate = method === "PATCH" &&
    /^\/api\/services\/[^/]+\/prices$/.test(pathname);
  const isOrderDelete = method === "DELETE" &&
    /^\/api\/orders\/[^/]+$/.test(pathname);
  if (session.role === "owner" &&
    (ownerActions.some(([action, route]) => action === method && route === pathname) ||
      isServicePriceUpdate || isStatusUpdate)) return;
  if (session.role === "admin" &&
    (adminActions.some(([action, route]) => action === method && route === pathname) ||
      isStatusUpdate || isDeliveryRequest || isOrderDelete)) return;
  throw new HttpError(403, "Akun ini tidak memiliki akses untuk tindakan tersebut.");
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8_000_000) {
      throw new HttpError(413, "Ukuran permintaan terlalu besar.");
    }
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new HttpError(400, "Format JSON tidak valid.");
  }
}

function requireText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${field} wajib diisi (maksimal ${maxLength} karakter).`);
  }
  return value.trim();
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `${field} tidak valid.`);
  }
  return value;
}

function requireAmount(value, field, allowZero = false) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new HttpError(400, `${field} harus berupa angka ${allowZero ? "nol atau lebih" : "lebih dari nol"}.`);
  }
  return amount;
}

function defaultShoeTypePrices(basePrice) {
  return Object.fromEntries(SHOE_TYPE_IDS.map((shoeType) => [
    shoeType,
    Math.round(basePrice * SHOE_PRICE_FACTORS[shoeType] / 1000) * 1000,
  ]));
}

function requireShoeTypePrices(value, basePrice) {
  if (value == null) {
    if (basePrice == null) throw new HttpError(400, "Tarif untuk setiap jenis sepatu wajib diisi.");
    return defaultShoeTypePrices(basePrice);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Tarif untuk setiap jenis sepatu tidak valid.");
  }
  const prices = {};
  for (const shoeType of SHOE_TYPE_IDS) {
    const price = Number(value[shoeType]);
    if (!Number.isSafeInteger(price) || price < 0 || price > 1_000_000_000) {
      throw new HttpError(400, "Isi harga valid (Rp0 hingga Rp1.000.000.000) untuk semua jenis sepatu.");
    }
    prices[shoeType] = price;
  }
  return prices;
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/api/dashboard") {
    const [orders, expenses] = await Promise.all([
      supabaseRequest("orders?select=total_amount,status,payments(amount)"),
      supabaseRequest("payments?select=amount&transaction_type=eq.expense"),
    ]);
    const summary = orders.reduce((result, order) => {
      const paid = (order.payments || []).reduce((sum, payment) => sum + Number(payment.amount), 0);
      result.cash_in += paid;
      result.outstanding += Math.max(Number(order.total_amount) - paid, 0);
      if (order.status === "delivered") result.completed_orders += 1;
      else result.active_orders += 1;
      return result;
    }, { cash_in: 0, outstanding: 0, completed_orders: 0, active_orders: 0 });
    summary.cash_out = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    summary.cash_balance = summary.cash_in - summary.cash_out;
    sendJson(response, 200, summary);
    return;
  }

  if (request.method === "GET" && pathname === "/api/customers") {
    const customers = await supabaseRequest("customers?select=id,name,phone&order=name.asc");
    sendJson(response, 200, customers);
    return;
  }

  if (request.method === "POST" && pathname === "/api/customers") {
    const body = await readJson(request);
    const name = requireText(body.name, "Nama pelanggan", 120);
    const phone = requireText(body.phone, "Nomor telepon", 30);
    const customers = await supabaseRequest("customers?select=id,name,phone", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name, phone }),
    });
    sendJson(response, 201, customers[0]);
    return;
  }

  if (request.method === "GET" && pathname === "/api/services") {
    const services = await supabaseRequest("services?select=id,name,price,price_by_shoe_type,estimated_days,is_active&is_active=eq.true&order=name.asc");
    sendJson(response, 200, services);
    return;
  }

  const servicePricesRoute = pathname.match(/^\/api\/services\/([^/]+)\/prices$/);
  if (request.method === "PATCH" && servicePricesRoute) {
    const serviceId = requireUuid(servicePricesRoute[1], "Layanan");
    const body = await readJson(request);
    const prices = requireShoeTypePrices(body.price_by_shoe_type);
    const updatedServices = await supabaseRequest(
      `services?id=eq.${encodeURIComponent(serviceId)}&select=id,name,price,price_by_shoe_type,estimated_days,is_active`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ price: prices.canvas, price_by_shoe_type: prices }),
      }
    );
    if (!updatedServices.length) throw new HttpError(404, "Layanan tidak ditemukan.");
    sendJson(response, 200, updatedServices[0]);
    return;
  }

  if (request.method === "POST" && pathname === "/api/services") {
    const body = await readJson(request);
    const name = requireText(body.name, "Nama layanan", 100);
    const price = requireAmount(body.price, "Harga layanan", true);
    const estimatedDays = Number(body.estimated_days);
    if (!Number.isInteger(estimatedDays) || estimatedDays < 1 || estimatedDays > 365) {
      throw new HttpError(400, "Estimasi layanan harus antara 1 dan 365 hari.");
    }
    const prices = requireShoeTypePrices(body.price_by_shoe_type, price);
    const services = await supabaseRequest("services?select=id,name,price,price_by_shoe_type,estimated_days,is_active", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        name,
        price: prices.canvas,
        price_by_shoe_type: prices,
        estimated_days: estimatedDays,
        is_active: true,
      }),
    });
    sendJson(response, 201, services[0]);
    return;
  }

  if (request.method === "GET" && pathname === "/api/orders") {
    const orders = await supabaseRequest(
      "orders?select=id,order_number,created_at,completed_at,status,total_amount,notes,service_id,shoe_type,shoe_brand,shoe_size,delivery_type,delivery_address,delivery_proof,customers(name,phone),services(name),payments(id,amount,payment_date,payment_method)&order=created_at.desc"
    );
    sendJson(response, 200, orders.map(publicOrder));
    return;
  }

  const deleteOrderRoute = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (request.method === "DELETE" && deleteOrderRoute) {
    const orderId = requireUuid(deleteOrderRoute[1], "Pesanan");
    const deletedOrders = await supabaseRequest(
      `orders?id=eq.${encodeURIComponent(orderId)}&select=id`,
      {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      }
    );
    if (!deletedOrders.length) throw new HttpError(404, "Pesanan tidak ditemukan.");
    sendJson(response, 200, { success: true });
    return;
  }

  if (request.method === "GET" && pathname === "/api/cashbook") {
    const transactions = await supabaseRequest(
      "payments?select=id,transaction_type,amount,payment_method,payment_date,description,category,orders(order_number,service_id,shoe_type,shoe_brand,shoe_size,total_amount,notes,customers(name),services(name))&order=payment_date.asc,id.asc"
    );
    const categoryNames = {
      supplies: "Bahan & perlengkapan",
      operations: "Operasional",
      other: "Lain-lain",
    };
    const entries = transactions.map((transaction) => {
      if (transaction.transaction_type === "expense") {
        return {
          id: transaction.id,
          entry_type: "expense",
          amount: Number(transaction.amount),
          entry_date: transaction.payment_date,
          payment_method: transaction.payment_method,
          description: `${categoryNames[transaction.category] || "Pengeluaran"} · ${transaction.description}`,
          reference: "-",
        };
      }

      const order = transaction.orders || {};
      const orderDetailsForCashbook = orderDetails(order);
      const orderItems = orderDetailsForCashbook.items;
      const deliveryFee = orderDetailsForCashbook.delivery_fee;
      const itemDescriptions = orderItems.map((item) => [
        item.service_name || order.services?.name || "Laundry sepatu",
        item.shoe_type ? SHOE_TYPE_NAMES[item.shoe_type] || item.shoe_type : "",
        item.shoe_brand ? `${item.shoe_brand} ukuran ${item.shoe_size || "-"}` : "",
      ].filter(Boolean).join(" · "));
      const details = [
        `Pembayaran ${itemDescriptions.join(" / ")}`,
        deliveryFee ? `Biaya antar ${rupiah.format(deliveryFee)}` : "",
        order.customers?.name || "",
      ].filter(Boolean);
      return {
        id: transaction.id,
        entry_type: "income",
        amount: Number(transaction.amount),
        entry_date: transaction.payment_date,
        payment_method: transaction.payment_method,
        description: details.join(" · "),
        reference: order.order_number || "-",
      };
    });
    sendJson(response, 200, entries);
    return;
  }

  if (request.method === "POST" && pathname === "/api/expenses") {
    const body = await readJson(request);
    const description = requireText(body.description, "Keterangan pengeluaran", 160);
    const amount = requireAmount(body.amount, "Jumlah pengeluaran");
    const categories = ["supplies", "operations", "other"];
    if (!categories.includes(body.category)) {
      throw new HttpError(400, "Kategori pengeluaran tidak valid.");
    }
    const paymentMethod = body.payment_method || "cash";
    if (!["cash", "transfer", "qris"].includes(paymentMethod)) {
      throw new HttpError(400, "Metode pembayaran tidak valid.");
    }
    const expenses = await supabaseRequest("payments?select=id,amount,payment_method,payment_date,description,category", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        transaction_type: "expense",
        order_id: null,
        description,
        category: body.category,
        amount,
        payment_method: paymentMethod,
      }),
    });
    sendJson(response, 201, expenses[0]);
    return;
  }

  const statusRoute = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  const deliveryRequestRoute = pathname.match(/^\/api\/orders\/([^/]+)\/delivery-request$/);
  if (request.method === "PATCH" && deliveryRequestRoute) {
    const orderId = requireUuid(deliveryRequestRoute[1], "Pesanan");
    const body = await readJson(request);
    const address = requireText(body.delivery_address, "Alamat pengantaran", 500);
    const orders = await supabaseRequest(
      `orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,status,total_amount,notes,delivery_type,delivery_address`
    );
    const order = orders[0];
    if (!order) throw new HttpError(404, "Pesanan tidak ditemukan.");
    const details = orderDetails(order);
    if (order.status !== "ready" || order.delivery_type !== "pickup" ||
      details.pickup_method !== "store_dropoff" || details.return_method !== "self_pickup" ||
      details.late_delivery) {
      throw new HttpError(400, "Pengantaran tambahan hanya dapat diminta untuk pesanan siap yang awalnya akan diambil sendiri.");
    }

    const updatedOrders = await supabaseRequest(
      `orders?id=eq.${encodeURIComponent(orderId)}&status=eq.ready&delivery_type=eq.pickup&total_amount=eq.${encodeURIComponent(order.total_amount)}&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          total_amount: Number(order.total_amount) + DELIVERY_FEE,
          delivery_type: "delivery",
          delivery_address: address,
          notes: orderItemsNote(details.items, details.notes, {
            pickupMethod: details.pickup_method,
            returnMethod: "employee_delivery",
            deliveryFee: DELIVERY_FEE,
            lateDelivery: true,
          }),
        }),
      }
    );
    if (!updatedOrders.length) {
      throw new HttpError(409, "Permintaan antar tidak dapat diproses karena status pesanan sudah berubah. Muat ulang antrean.");
    }
    sendJson(response, 200, {
      success: true,
      delivery_fee: DELIVERY_FEE,
      total_amount: Number(order.total_amount) + DELIVERY_FEE,
    });
    return;
  }

  if (request.method === "PATCH" && statusRoute) {
    const orderId = requireUuid(statusRoute[1], "Pesanan");
    const body = await readJson(request);
    const orders = await supabaseRequest(
      `orders?id=eq.${encodeURIComponent(orderId)}&select=id,status,total_amount,notes,delivery_type`
    );
    const order = orders[0];
    if (!order) throw new HttpError(404, "Pesanan tidak ditemukan.");
    const details = orderDetails(order);
    const statusFlow = order.delivery_type === "delivery"
      ? ["received", "washing", "ready", "in_transit", "delivered"]
      : ["received", "washing", "ready", "delivered"];
    if (!statusFlow.includes(body.status)) {
      throw new HttpError(400, "Status pesanan tidak valid.");
    }
    const currentIndex = statusFlow.indexOf(order.status === "drying" ? "washing" : order.status);
    if (statusFlow[currentIndex + 1] !== body.status) {
      throw new HttpError(400, "Status pesanan harus diperbarui berurutan.");
    }
    if (body.status === "in_transit" && details.late_delivery) {
      const payments = await supabaseRequest(
        `payments?order_id=eq.${encodeURIComponent(orderId)}&transaction_type=eq.income&select=amount`
      );
      const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      if (paid < Number(order.total_amount)) {
        throw new HttpError(400, `Pesanan hanya boleh diantar setelah lunas. Sisa tagihan termasuk ongkir: ${rupiah.format(Number(order.total_amount) - paid)}.`);
      }
    }
    const update = { status: body.status };
    if (body.status === "delivered") update.completed_at = new Date().toISOString();
    if (body.status === "delivered" && order.delivery_type === "delivery") {
      if (typeof body.delivery_proof !== "string" ||
        !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(body.delivery_proof) ||
        body.delivery_proof.length > 7_000_000) {
        throw new HttpError(400, "Foto bukti pengantaran wajib berupa gambar (maksimal 5 MB).");
      }
      update.delivery_proof = body.delivery_proof;
    }
    const updatedOrders = await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,status,completed_at,delivery_proof`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(update),
    });
    sendJson(response, 200, updatedOrders[0]);
    return;
  }

  if (request.method === "POST" && pathname === "/api/orders") {
    const body = await readJson(request);
    const customerName = requireText(body.customer_name, "Nama pelanggan", 120);
    const customerPhone = requireText(body.customer_phone, "Nomor telepon", 30);
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
      throw new HttpError(400, "Pesanan harus berisi 1 sampai 50 pasang sepatu.");
    }
    const requestedItems = body.items.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new HttpError(400, `Rincian pasang ke-${index + 1} tidak valid.`);
      }
      const shoeType = requireText(item.shoe_type, `Jenis sepatu pasang ke-${index + 1}`, 20);
      return {
        serviceId: requireUuid(item.service_id, `Layanan pasang ke-${index + 1}`),
        shoeType,
        storedShoeType: SHOE_TYPE_IDS.includes(shoeType) ? shoeType : "other",
        shoeBrand: requireText(item.shoe_brand, `Merek sepatu pasang ke-${index + 1}`, 80),
        shoeSize: requireText(item.shoe_size, `Ukuran sepatu pasang ke-${index + 1}`, 20),
      };
    });
    const pickupMethod = body.pickup_method;
    const returnMethod = body.return_method;
    if (!["store_dropoff", "home_pickup"].includes(pickupMethod)) {
      throw new HttpError(400, "Cara sepatu masuk ke laundry tidak valid.");
    }
    if (pickupMethod === "store_dropoff" && !["self_pickup", "employee_delivery"].includes(returnMethod)) {
      throw new HttpError(400, "Pilih cara pengambilan sepatu setelah selesai.");
    }
    const employeeDelivery = pickupMethod === "home_pickup" || returnMethod === "employee_delivery";
    const deliveryType = employeeDelivery ? "delivery" : "pickup";
    const deliveryFee = pickupMethod === "store_dropoff" && returnMethod === "employee_delivery"
      ? DELIVERY_FEE
      : 0;
    const deliveryAddress = employeeDelivery
      ? requireText(body.delivery_address, "Alamat penjemputan atau pengantaran", 500)
      : "";
    const initialPayment = requireAmount(body.initial_payment ?? 0, "Uang muka", true);
    const paymentMethod = body.payment_method || "cash";
    const userNotes = body.notes == null ? "" : body.notes;
    if (typeof userNotes !== "string" || userNotes.length > 500) {
      throw new HttpError(400, "Catatan harus berupa teks (maksimal 500 karakter).");
    }
    if (!["cash", "transfer", "qris"].includes(paymentMethod)) {
      throw new HttpError(400, "Metode pembayaran tidak valid.");
    }
    const requestedServiceIds = [...new Set(requestedItems.map((item) => item.serviceId))];
    const services = await supabaseRequest(
      `services?id=in.(${requestedServiceIds.map(encodeURIComponent).join(",")})&select=id,name,price_by_shoe_type,is_active`
    );
    const serviceById = new Map(services.map((service) => [service.id, service]));
    const items = requestedItems.map((item, index) => {
      const service = serviceById.get(item.serviceId);
      if (!service || !service.is_active) {
        throw new HttpError(400, `Layanan pasang ke-${index + 1} tidak ditemukan atau sedang tidak aktif.`);
      }
      const price = Number(service.price_by_shoe_type?.[item.storedShoeType]);
      if (!Number.isSafeInteger(price) || price < 0) {
        throw new HttpError(400, `Tarif layanan pasang ke-${index + 1} tidak valid.`);
      }
      return {
        service_id: service.id,
        service_name: service.name,
        shoe_type: item.shoeType,
        shoe_brand: item.shoeBrand,
        shoe_size: item.shoeSize,
        price,
      };
    });
    const serviceTotal = items.reduce((sum, item) => sum + item.price, 0);
    const totalPrice = serviceTotal + deliveryFee;
    const minimumPayment = pickupMethod === "home_pickup"
      ? totalPrice
      : items.reduce((sum, item) => sum + Math.ceil(item.price * 0.7), 0) + deliveryFee;
    if (!Number.isSafeInteger(totalPrice) || totalPrice <= 0) {
      throw new HttpError(400, "Total tarif pesanan harus lebih dari Rp0.");
    }
    if (initialPayment < minimumPayment) {
      const minimumDescription = pickupMethod === "home_pickup"
        ? "Pembayaran untuk layanan jemput-antar wajib lunas 100%"
        : "Pembayaran awal minimal 70% dari tarif tiap pasang";
      throw new HttpError(400, `${minimumDescription}${deliveryFee ? " ditambah biaya antar" : ""}, yaitu ${rupiah.format(minimumPayment)}.`);
    }
    if (initialPayment > totalPrice) {
      throw new HttpError(400, "Pembayaran tidak boleh melebihi total pesanan.");
    }

    const firstItem = items[0];
    const storedShoeType = SHOE_TYPE_IDS.includes(firstItem.shoe_type) ? firstItem.shoe_type : "other";
    let orderId = null;
    try {
      const createdOrder = await supabaseRequest("rpc/create_order_with_payment", {
        method: "POST",
        body: JSON.stringify({
          p_customer_name: customerName,
          p_customer_phone: customerPhone,
          p_service_id: firstItem.service_id,
          p_shoe_brand: firstItem.shoe_brand,
          p_shoe_size: firstItem.shoe_size,
          p_delivery_type: deliveryType,
          p_delivery_address: deliveryAddress,
          p_initial_payment: 0,
          p_payment_method: paymentMethod,
          p_notes: "",
          p_shoe_type: storedShoeType,
        }),
      });
      orderId = createdOrder?.id;
      if (typeof orderId !== "string") {
        throw new Error("Supabase tidak mengembalikan nomor pesanan yang dapat disimpan.");
      }

      const updatedOrders = await supabaseRequest(
        `orders?id=eq.${encodeURIComponent(orderId)}&select=id`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            total_amount: totalPrice,
            notes: orderItemsNote(items, userNotes, {
              pickupMethod,
              returnMethod: employeeDelivery ? "employee_delivery" : returnMethod,
              deliveryFee,
              lateDelivery: false,
            }),
          }),
        }
      );
      if (!updatedOrders.length) throw new Error("Rincian pesanan tidak berhasil disimpan.");

      let payment = null;
      if (initialPayment > 0) {
        payment = await supabaseRequest("rpc/record_order_payment", {
          method: "POST",
          body: JSON.stringify({
            p_order_id: orderId,
            p_amount: initialPayment,
            p_payment_method: paymentMethod,
          }),
        });
      }
      sendJson(response, 201, {
        ...createdOrder,
        total_amount: totalPrice,
        items,
        initial_payment: payment?.amount || 0,
      });
    } catch (error) {
      if (orderId) {
        try {
          await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}`, { method: "DELETE" });
        } catch (cleanupError) {
          throw new Error(`${error.message} Pesanan ${orderId} juga gagal dibatalkan otomatis: ${cleanupError.message}`);
        }
      }
      throw error;
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/payments") {
    const body = await readJson(request);
    const orderId = requireUuid(body.order_id, "Pesanan");
    const amount = requireAmount(body.amount, "Jumlah pembayaran");
    const paymentMethod = body.payment_method || "cash";
    if (!["cash", "transfer", "qris"].includes(paymentMethod)) {
      throw new HttpError(400, "Metode pembayaran tidak valid.");
    }
    const orders = await supabaseRequest(
      `orders?id=eq.${encodeURIComponent(orderId)}&select=id,delivery_type,notes`
    );
    if (!orders.length) throw new HttpError(404, "Pesanan tidak ditemukan.");
    if (orderDetails(orders[0]).late_delivery && paymentMethod !== "qris") {
      throw new HttpError(400, "Pembayaran untuk pengantaran tambahan hanya dapat dicatat melalui QRIS.");
    }
    const result = await supabaseRequest("rpc/record_order_payment", {
      method: "POST",
      body: JSON.stringify({
        p_order_id: orderId,
        p_amount: amount,
        p_payment_method: paymentMethod,
      }),
    });
    sendJson(response, 201, result);
    return;
  }

  sendJson(response, 404, { error: "Endpoint tidak ditemukan." });
}

async function serveFrontend(response, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    throw new HttpError(400, "Alamat halaman tidak valid.");
  }
  const filePath = path.resolve(FRONTEND_DIR, `.${relativePath}`);
  if (!filePath.startsWith(`${FRONTEND_DIR}${path.sep}`)) {
    throw new HttpError(403, "Akses file ditolak.");
  }

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      throw new HttpError(404, "Halaman tidak ditemukan.");
    }
    throw error;
  }
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  response.end(content);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const origin = request.headers.origin;
  if (origin && !FRONTEND_ORIGINS.has(origin)) {
    sendJson(response, 403, { error: "Origin aplikasi tidak diizinkan." });
    return;
  }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      try {
        await supabaseRequest("services?select=id&limit=1");
        sendJson(response, 200, { status: "ok", database: "connected" });
      } catch (error) {
        const reason = error.status === 401
          ? "invalid_api_key"
          : error.status === 403
            ? "database_access_denied"
            : "database_unavailable";
        sendJson(response, 503, { status: "error", database: "unavailable", reason });
      }
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "POST" && url.pathname === "/api/login") {
        const body = await readJson(request);
        const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
        const account = Object.prototype.hasOwnProperty.call(accounts, username)
          ? accounts[username]
          : null;
        if (!account || !passwordsMatch(body.password, account.password)) {
          throw new HttpError(401, "Username atau password tidak sesuai.");
        }
        for (const [oldToken, oldSession] of sessions) {
          if (oldSession.expiresAt <= Date.now()) sessions.delete(oldToken);
        }
        const token = randomBytes(32).toString("hex");
        const session = {
          username: account.username,
          role: account.role,
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        sessions.set(token, session);
        setSessionCookie(response, token, SESSION_TTL_MS / 1000);
        sendJson(response, 200, { username: account.username, role: account.role, token });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/session") {
        const session = getSession(request);
        if (!session) throw new HttpError(401, "Sesi login tidak ditemukan.");
        sendJson(response, 200, { username: session.username, role: session.role });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/logout") {
        const token = getSessionToken(request);
        if (token) sessions.delete(token);
        setSessionCookie(response, "", 0);
        sendJson(response, 200, { success: true });
        return;
      }

      const session = getSession(request);
      if (!session) throw new HttpError(401, "Silakan login untuk melanjutkan.");
      requireRole(session, request.method, url.pathname);
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new HttpError(405, "Metode permintaan tidak didukung.");
    }
    await serveFrontend(response, url.pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error.status || 500;
    if (status >= 500) console.error(error);
    sendJson(response, status, {
      error: status >= 500 ? "Terjadi kesalahan saat memproses permintaan." : error.message,
    });
  }
});

let validSupabaseUrl = false;
try {
  const parsedUrl = new URL(SUPABASE_URL);
  validSupabaseUrl = ["http:", "https:"].includes(parsedUrl.protocol) &&
    Boolean(parsedUrl.hostname) &&
    !parsedUrl.username &&
    !parsedUrl.password;
} catch {
  validSupabaseUrl = false;
}

if (SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_")) {
  console.error(
    "SUPABASE_SECRET_KEY berisi Publishable key. Backend ini memerlukan Supabase Secret key " +
    "(sb_secret_...) atau service_role key lama. Simpan key tersebut hanya di .env atau environment hosting."
  );
}

if (!validSupabaseUrl || !hasServerSupabaseKey() ||
  (isProduction && Object.keys(accounts).length !== 2)) {
  console.error(
    "Konfigurasi Supabase tidak valid. Atur SUPABASE_URL dan SUPABASE_SECRET_KEY " +
    "(atau SUPABASE_SERVICE_ROLE_KEY), ADMIN_USERNAME, ADMIN_PASSWORD, OWNER_USERNAME, " +
    "dan OWNER_PASSWORD di file .env atau environment hosting. Key Supabase harus berupa Secret/service_role, bukan publishable/anon."
  );
  process.exitCode = 1;
} else {
  server.listen(PORT, () => {
    console.log(`T-Step Lab berjalan di http://localhost:${PORT}`);
    checkSupabaseConnection();
  });
}
