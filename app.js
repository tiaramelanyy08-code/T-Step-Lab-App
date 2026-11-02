const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const formMessages = {
  order: document.querySelector("#order-message"),
  expense: document.querySelector("#expense-message"),
  ledger: document.querySelector("#ledger-message"),
};

const LOCAL_STORAGE_KEY = "t-step-lab-local-v1";
const LEGACY_LOCAL_STORAGE_KEY = "kaskicks-local-v1";
const DELIVERY_FEE = 5000;
const connectionStatus = document.querySelector("#connection-status");
const API_BASE_URL = typeof window.TSTEP_API_BASE_URL === "string"
  ? window.TSTEP_API_BASE_URL.trim().replace(/\/+$/, "")
  : "";
const SHOE_TYPES = [
  { id: "canvas", name: "Canvas", factor: 1 },
  { id: "suede", name: "Suede", factor: 1.4 },
  { id: "white", name: "Sepatu putih", factor: 1.2 },
  { id: "kids", name: "Sepatu anak", factor: 0.85 },
  { id: "leather", name: "Kulit", factor: 1.5 },
  { id: "mesh", name: "Mesh / knit", factor: 1.1 },
  { id: "other", name: "Lainnya", factor: 1 },
];
const ROLE_PAGES = {
  admin: [
    { id: "new-order", label: "Input Order Masuk", icon: "＋" },
    { id: "orders", label: "Status Antrean & Kasir", icon: "◷" },
  ],
  owner: [
    { id: "owner-dashboard", label: "Dashboard Ringkasan", icon: "▦" },
    { id: "orders", label: "Status Antrean", icon: "◷" },
    { id: "reports", label: "Laporan Transaksi", icon: "▤" },
    { id: "services", label: "Kelola Layanan & Harga", icon: "◇" },
    { id: "cashbook", label: "Buku Kas", icon: "≡" },
    { id: "journal", label: "Jurnal Umum", icon: "⇄" },
  ],
};
let currentRole = "";
let latestOrders = [];
let serviceCatalog = [];
let shoeItems = [{ service_id: "", shoe_type: "canvas", shoe_type_other: "", shoe_brand: "", shoe_size: "" }];

function defaultPriceMap(basePrice) {
  return Object.fromEntries(SHOE_TYPES.map(({ id, factor }) => [
    id,
    Math.round(Number(basePrice) * factor / 1000) * 1000,
  ]));
}

function showMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle("success", success);
}

function setConnectionStatus(isConnected) {
  connectionStatus.textContent = isConnected
    ? "Terhubung ke Supabase"
    : "Backend tidak terhubung";
  connectionStatus.classList.toggle("local", false);
  connectionStatus.classList.toggle("online", isConnected);
  connectionStatus.classList.toggle("offline", !isConnected);
}

function readLocalData() {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY) || localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
  if (saved) {
    try {
      const data = JSON.parse(saved);
      data.customers ||= [];
      data.services ||= [];
      data.orders ||= [];
      data.payments ||= [];
      data.services.forEach((service) => {
        service.price_by_shoe_type ||= defaultPriceMap(service.price);
      });
      data.orders.forEach((order) => {
        order.shoe_type ||= "canvas";
        order.completed_at ||= null;
        order.pickup_method ||= order.delivery_type === "delivery" ? "home_pickup" : "store_dropoff";
        order.delivery_fee ||= 0;
        order.return_method ||= order.delivery_type === "delivery" ? "employee_delivery" : "self_pickup";
        order.late_delivery ||= false;
      });
      data.payments.forEach((payment) => {
        payment.transaction_type ||= "income";
      });
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
      return data;
    } catch {
      throw new Error("Data lokal rusak. Hapus data T-Step Lab pada penyimpanan browser untuk memulai lagi.");
    }
  }
  return {
    customers: [],
    services: [
      { id: "local-service-deep-clean", name: "Deep Clean", description: "Pembersihan menyeluruh", price: 50000, price_by_shoe_type: defaultPriceMap(50000), estimated_days: 3, is_active: true },
      { id: "local-service-fast-clean", name: "Fast Clean", description: "Pembersihan ringan", price: 30000, price_by_shoe_type: defaultPriceMap(30000), estimated_days: 1, is_active: true },
      { id: "local-service-unyellowing", name: "Unyellowing", description: "Perawatan sepatu menguning", price: 75000, price_by_shoe_type: defaultPriceMap(75000), estimated_days: 5, is_active: true },
      { id: "local-service-repaint", name: "Repaint", description: "Pengecatan ulang sepatu", price: 100000, price_by_shoe_type: defaultPriceMap(100000), estimated_days: 7, is_active: true },
    ],
    orders: [],
    payments: [],
  };
}

function saveLocalData(data) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch {
    throw new Error("Data tidak dapat disimpan di browser. Periksa ruang penyimpanan yang tersedia.");
  }
}

function makeLocalId() {
  return globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localApi(path, options) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};
  let result;

  if (path === "login" && method === "POST") {
    throw new Error("Login harus dilakukan melalui backend yang terhubung ke Supabase.");
  }
  if (path === "session" && method === "GET") {
    const username = sessionStorage.getItem("t-step-lab-user");
    const role = sessionStorage.getItem("t-step-lab-role");
    if (!username || !["admin", "owner"].includes(role)) {
      throw new Error("Sesi login tidak ditemukan.");
    }
    return { username, role };
  }
  if (path === "logout" && method === "POST") return { success: true };

  const data = readLocalData();
  if (path === "dashboard" && method === "GET") {
    const cashIn = data.payments
      .filter((payment) => payment.transaction_type !== "expense")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const cashOut = data.payments
      .filter((payment) => payment.transaction_type === "expense")
      .reduce((sum, expense) => sum + Number(expense.amount), 0);
    const outstanding = data.orders.reduce((sum, order) => {
      const paid = data.payments
        .filter((payment) => payment.order_id === order.id)
        .reduce((paymentSum, payment) => paymentSum + Number(payment.amount), 0);
      return sum + Math.max(Number(order.total_amount) - paid, 0);
    }, 0);
    result = {
      cash_in: cashIn,
      cash_out: cashOut,
      cash_balance: cashIn - cashOut,
      outstanding,
      completed_orders: data.orders.filter((order) => order.status === "delivered").length,
      active_orders: data.orders.filter((order) => order.status !== "delivered").length,
    };
  } else if (path === "customers" && method === "GET") {
    result = [...data.customers].sort((a, b) => a.name.localeCompare(b.name, "id"));
  } else if (path === "customers" && method === "POST") {
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    if (!name || name.length > 120 || !phone || phone.length > 30) {
      throw new Error("Nama dan nomor telepon pelanggan wajib diisi.");
    }
    const customer = { id: makeLocalId(), name, phone, created_at: new Date().toISOString() };
    data.customers.push(customer);
    saveLocalData(data);
    result = customer;
  } else if (path === "services" && method === "GET") {
    result = data.services.filter((service) => service.is_active);
  } else if (path === "services" && method === "POST") {
    const name = String(body.name || "").trim();
    const price = Number(body.price);
    const estimatedDays = Number(body.estimated_days);
    if (!name || name.length > 100) throw new Error("Nama layanan wajib diisi (maksimal 100 karakter).");
    if (data.services.some((service) => service.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Nama layanan tersebut sudah ada.");
    }
    if (!Number.isFinite(price) || price < 0) throw new Error("Harga layanan tidak valid.");
    if (!Number.isInteger(estimatedDays) || estimatedDays < 1) throw new Error("Estimasi layanan minimal 1 hari.");
    result = {
      id: makeLocalId(),
      name,
      description: "",
      price,
      price_by_shoe_type: body.price_by_shoe_type || defaultPriceMap(price),
      estimated_days: estimatedDays,
      is_active: true,
    };
    data.services.push(result);
    saveLocalData(data);
  } else if (path.startsWith("services/") && path.endsWith("/prices") && method === "PATCH") {
    const serviceId = path.slice("services/".length, -"/prices".length);
    const service = data.services.find((item) => item.id === serviceId);
    if (!service) throw new Error("Layanan tidak ditemukan.");
    const prices = body.price_by_shoe_type;
    if (!prices || SHOE_TYPES.some(({ id }) =>
      !Number.isSafeInteger(Number(prices[id])) || Number(prices[id]) < 0
    )) {
      throw new Error("Isi harga yang valid untuk setiap jenis sepatu.");
    }
    service.price_by_shoe_type = Object.fromEntries(SHOE_TYPES.map(({ id }) => [id, Number(prices[id])]));
    service.price = service.price_by_shoe_type.canvas;
    saveLocalData(data);
    result = service;
  } else if (path === "cashbook" && method === "GET") {
    result = data.payments.map((payment) => {
      if (payment.transaction_type === "expense") {
        const category = { supplies: "Bahan & perlengkapan", operations: "Operasional", other: "Lain-lain" }[payment.category] || "Pengeluaran";
        return {
          id: payment.id,
          entry_type: "expense",
          amount: Number(payment.amount),
          entry_date: payment.payment_date,
          payment_method: payment.payment_method,
          description: `${category} · ${payment.description}`,
          reference: "-",
        };
      }
        const order = data.orders.find((item) => item.id === payment.order_id);
        const customer = data.customers.find((item) => item.id === order?.customer_id);
        const orderItems = order?.items?.length
          ? order.items
          : [{
            service_name: data.services.find((item) => item.id === order?.service_id)?.name,
            shoe_type: order?.shoe_type,
            shoe_brand: order?.shoe_brand,
            shoe_size: order?.shoe_size,
          }];
        const itemDescriptions = orderItems.map((item) => [
          item.service_name || "Laundry sepatu",
          item.shoe_type ? SHOE_TYPES.find((type) => type.id === item.shoe_type)?.name || item.shoe_type : "",
          item.shoe_brand ? `${item.shoe_brand} ukuran ${item.shoe_size || "-"}` : "",
        ].filter(Boolean).join(" · "));
        return {
          id: payment.id,
          entry_type: "income",
          amount: Number(payment.amount),
          entry_date: payment.payment_date,
          payment_method: payment.payment_method,
          description: [
            `Pembayaran ${itemDescriptions.join(" / ")}`,
            customer?.name || "",
          ].filter(Boolean).join(" · "),
          reference: order?.order_number || "-",
        };
    }).sort((a, b) =>
      a.entry_date.localeCompare(b.entry_date) || a.id.localeCompare(b.id)
    );
  } else if (path === "expenses" && method === "POST") {
    const description = String(body.description || "").trim();
    const amount = Number(body.amount);
    const categories = ["supplies", "operations", "other"];
    if (!description || description.length > 160) throw new Error("Keterangan pengeluaran wajib diisi (maksimal 160 karakter).");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Jumlah pengeluaran harus lebih dari nol.");
    if (!categories.includes(body.category)) throw new Error("Kategori pengeluaran tidak valid.");
    if (!["cash", "transfer", "qris"].includes(body.payment_method)) throw new Error("Metode pembayaran tidak valid.");
    result = {
      id: makeLocalId(),
      description,
      category: body.category,
      transaction_type: "expense",
      order_id: null,
      amount,
      payment_method: body.payment_method,
      payment_date: new Date().toISOString(),
    };
    data.payments.push(result);
    saveLocalData(data);
  } else if (path === "orders" && method === "GET") {
    result = [...data.orders]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((order) => ({
        ...order,
        customers: data.customers.find((customer) => customer.id === order.customer_id),
        services: data.services.find((service) => service.id === order.service_id),
        items: order.items || [{
          service_id: order.service_id,
          service_name: data.services.find((service) => service.id === order.service_id)?.name || "Layanan",
          shoe_type: order.shoe_type,
          shoe_brand: order.shoe_brand,
          shoe_size: order.shoe_size,
          price: Number(order.total_amount),
        }],
        payments: data.payments.filter((payment) => payment.order_id === order.id),
      }));
  } else if (path === "orders" && method === "POST") {
    const customerName = String(body.customer_name || "").trim();
    const customerPhone = String(body.customer_phone || "").trim();
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
      throw new Error("Pesanan harus berisi 1 sampai 50 pasang sepatu.");
    }
    const items = body.items.map((item) => {
      const service = data.services.find((entry) => entry.id === item.service_id && entry.is_active);
      const shoeType = String(item.shoe_type || "").trim();
      const priceType = SHOE_TYPES.some((entry) => entry.id === shoeType) ? shoeType : "other";
      const price = Number(service?.price_by_shoe_type?.[priceType]);
      const shoeBrand = String(item.shoe_brand || "").trim();
      const shoeSize = String(item.shoe_size || "").trim();
      if (!service) throw new Error("Pilih layanan yang tersedia untuk setiap pasang.");
      if (!shoeType || shoeType.length > 20 || !Number.isFinite(price)) {
        throw new Error("Pilih jenis sepatu dengan tarif yang tersedia.");
      }
      if (!shoeBrand || shoeBrand.length > 80 || !shoeSize || shoeSize.length > 20) {
        throw new Error("Merek dan ukuran sepatu wajib diisi untuk setiap pasang.");
      }
      return {
        service_id: service.id,
        service_name: service.name,
        shoe_type: shoeType,
        shoe_brand: shoeBrand,
        shoe_size: shoeSize,
        price,
      };
    });
    const pickupMethod = body.pickup_method;
    const returnMethod = body.return_method;
    if (!["store_dropoff", "home_pickup"].includes(pickupMethod)) {
      throw new Error("Cara sepatu masuk ke laundry tidak valid.");
    }
    if (pickupMethod === "store_dropoff" && !["self_pickup", "employee_delivery"].includes(returnMethod)) {
      throw new Error("Pilih cara pengambilan sepatu setelah selesai.");
    }
    const employeeDelivery = pickupMethod === "home_pickup" || returnMethod === "employee_delivery";
    const deliveryType = employeeDelivery ? "delivery" : "pickup";
    const deliveryFee = pickupMethod === "store_dropoff" && returnMethod === "employee_delivery" ? DELIVERY_FEE : 0;
    const serviceTotal = items.reduce((sum, item) => sum + item.price, 0);
    const totalPrice = serviceTotal + deliveryFee;
    const minimumPayment = pickupMethod === "home_pickup"
      ? totalPrice
      : items.reduce((sum, item) => sum + Math.ceil(item.price * 0.7), 0) + deliveryFee;
    const initialPayment = Number(body.initial_payment || 0);
    if (employeeDelivery && !String(body.delivery_address || "").trim()) {
      throw new Error("Alamat penjemputan atau pengantaran wajib diisi.");
    }
    if (!customerName || customerName.length > 120 || !customerPhone || customerPhone.length > 30) {
      throw new Error("Nama dan nomor telepon pelanggan wajib diisi.");
    }
    if (!Number.isSafeInteger(totalPrice) || totalPrice <= 0) {
      throw new Error("Total tarif pesanan harus lebih dari Rp0.");
    }
    if (!Number.isFinite(initialPayment) || initialPayment < minimumPayment || initialPayment > totalPrice) {
      throw new Error(`Pembayaran awal minimal ${rupiah.format(minimumPayment)} dan tidak boleh melebihi total pesanan.`);
    }
    if (!["cash", "transfer", "qris"].includes(body.payment_method)) {
      throw new Error("Metode pembayaran tidak valid.");
    }
    const now = new Date();
    let customer = data.customers.find((item) => item.phone === customerPhone);
    if (customer) {
      customer.name = customerName;
    } else {
      customer = {
        id: makeLocalId(),
        name: customerName,
        phone: customerPhone,
        created_at: now.toISOString(),
      };
      data.customers.push(customer);
    }
    const order = {
      id: makeLocalId(),
      order_number: `ORD-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${String(data.orders.length + 1).padStart(5, "0")}`,
      customer_id: customer.id,
      service_id: items[0].service_id,
      shoe_type: items[0].shoe_type,
      shoe_brand: items[0].shoe_brand,
      shoe_size: items[0].shoe_size,
      items,
      delivery_type: deliveryType,
      pickup_method: pickupMethod,
      return_method: employeeDelivery ? "employee_delivery" : returnMethod,
      delivery_fee: deliveryFee,
      late_delivery: false,
      delivery_address: String(body.delivery_address || "").trim(),
      payment_method: body.payment_method,
      delivery_proof: null,
      status: "received",
      completed_at: null,
      total_amount: totalPrice,
      payment_status: initialPayment >= totalPrice ? "paid" : "partial",
      payment_method: body.payment_method,
      notes: String(body.notes || "").trim(),
      created_at: now.toISOString(),
    };
    data.orders.push(order);
    if (initialPayment > 0) {
      data.payments.push({
        id: makeLocalId(),
        order_id: order.id,
        amount: initialPayment,
        payment_method: body.payment_method,
        payment_date: now.toISOString(),
      });
    }
    saveLocalData(data);
    result = order;
  } else if (path === "payments" && method === "POST") {
    const order = data.orders.find((item) => item.id === body.order_id);
    const amount = Number(body.amount);
    const paid = data.payments
      .filter((payment) => payment.order_id === body.order_id)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    if (!order) throw new Error("Pesanan tidak ditemukan.");
    if (order.late_delivery && body.payment_method !== "qris") {
      throw new Error("Pembayaran untuk pengantaran tambahan hanya dapat dicatat melalui QRIS.");
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(order.total_amount) - paid) {
      throw new Error("Jumlah pembayaran melebihi sisa tagihan atau tidak valid.");
    }
    if (!["cash", "transfer", "qris"].includes(body.payment_method)) {
      throw new Error("Metode pembayaran tidak valid.");
    }
    result = {
      id: makeLocalId(),
      order_id: order.id,
      amount,
      payment_method: body.payment_method,
      payment_date: new Date().toISOString(),
    };
    data.payments.push(result);
    const updatedPaid = paid + amount;
    order.payment_status = updatedPaid >= Number(order.total_amount)
      ? "paid"
      : updatedPaid > 0
        ? "partial"
        : "unpaid";
    saveLocalData(data);
  } else if (path.startsWith("orders/") && method === "DELETE") {
    const orderId = path.slice("orders/".length);
    const orderIndex = data.orders.findIndex((item) => item.id === orderId);
    if (orderIndex < 0) throw new Error("Pesanan tidak ditemukan.");
    data.orders.splice(orderIndex, 1);
    data.payments = data.payments.filter((payment) => payment.order_id !== orderId);
    saveLocalData(data);
    result = { success: true };
  } else if (path.startsWith("orders/") && path.endsWith("/delivery-request") && method === "PATCH") {
    const orderId = path.slice("orders/".length, -"/delivery-request".length);
    const order = data.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Pesanan tidak ditemukan.");
    if (order.status !== "ready" || order.delivery_type !== "pickup" ||
      order.pickup_method !== "store_dropoff" || order.return_method !== "self_pickup" ||
      order.late_delivery) {
      throw new Error("Pengantaran tambahan hanya dapat diminta untuk pesanan siap yang awalnya akan diambil sendiri.");
    }
    const address = String(body.delivery_address || "").trim();
    if (!address || address.length > 500) throw new Error("Alamat pengantaran wajib diisi (maksimal 500 karakter).");
    order.total_amount = Number(order.total_amount) + DELIVERY_FEE;
    order.delivery_fee = DELIVERY_FEE;
    order.delivery_type = "delivery";
    order.return_method = "employee_delivery";
    order.late_delivery = true;
    order.delivery_address = address;
    saveLocalData(data);
    result = { success: true, delivery_fee: DELIVERY_FEE, total_amount: order.total_amount };
  } else if (path.startsWith("orders/") && path.endsWith("/status") && method === "PATCH") {
    const orderId = path.slice("orders/".length, -"/status".length);
    const order = data.orders.find((item) => item.id === orderId);
    if (!order) throw new Error("Pesanan tidak ditemukan.");
    const statusFlow = order.delivery_type === "delivery"
      ? ["received", "washing", "ready", "in_transit", "delivered"]
      : ["received", "washing", "ready", "delivered"];
    if (!statusFlow.includes(body.status)) {
      throw new Error("Status pesanan tidak valid.");
    }
    const currentIndex = statusFlow.indexOf(order.status === "drying" ? "washing" : order.status);
    if (statusFlow[currentIndex + 1] !== body.status) {
      throw new Error("Status pesanan harus diperbarui berurutan.");
    }
    if (body.status === "in_transit" && order.late_delivery) {
      const paid = paymentsTotal(order);
      if (paid < Number(order.total_amount)) {
        throw new Error(`Pesanan hanya boleh diantar setelah lunas. Sisa tagihan termasuk ongkir: ${rupiah.format(Number(order.total_amount) - paid)}.`);
      }
    }
    if (body.status === "delivered" && order.delivery_type === "delivery" && !body.delivery_proof) {
      throw new Error("Foto bukti pengantaran wajib diunggah sebelum pesanan diselesaikan.");
    }
    order.status = body.status;
    if (body.status === "delivered") order.completed_at = new Date().toISOString();
    if (body.delivery_proof) order.delivery_proof = body.delivery_proof;
    saveLocalData(data);
    result = order;
  } else {
    throw new Error("Aksi tersebut tidak tersedia dalam mode lokal.");
  }
  return result;
}

async function api(path, options = {}) {
  if (window.location.protocol === "file:") {
    throw new Error("Buka aplikasi melalui http://localhost:3000 atau klik dua kali Buka T-Step Lab.bat.");
  }
  const token = sessionStorage.getItem("t-step-api-token");
  try {
    const response = await fetch(`${API_BASE_URL}/api/${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      setConnectionStatus(false);
      throw new Error("Alamat API backend belum benar. Halaman ini tidak dapat terhubung ke database.");
    }
    const result = await response.json();
    if (!response.ok) {
      if (response.status >= 500) setConnectionStatus(false);
      throw new Error(result.error || "Terjadi kesalahan pada server.");
    }
    if (!["login", "session", "logout"].includes(path)) setConnectionStatus(true);
    return result;
  } catch (error) {
    if (error instanceof TypeError) {
      setConnectionStatus(false);
      throw new Error(`Backend Supabase tidak dapat dijangkau${API_BASE_URL ? ` di ${API_BASE_URL}` : ""}. Periksa URL backend dan pastikan server aktif.`);
    }
    throw error;
  }
}

async function checkBackendConnection() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";
    const health = contentType.includes("application/json") ? await response.json() : null;
    const isConnected = response.ok && health?.database === "connected";
    setConnectionStatus(isConnected);
    return isConnected;
  } catch {
    setConnectionStatus(false);
    return false;
  }
}

function paymentsTotal(order) {
  return (order.payments || []).reduce((total, payment) => total + Number(payment.amount), 0);
}

function isStorePickupBalanceOrder(order) {
  return order.delivery_type === "pickup" &&
    order.pickup_method === "store_dropoff" &&
    order.return_method === "self_pickup" &&
    !order.late_delivery;
}

function statusLabel(status) {
  return {
    received: "Antrean",
    washing: "Sedang Dicuci",
    drying: "Dikeringkan",
    ready: "Siap Diambil",
    in_transit: "Dalam Perjalanan",
    delivered: "Selesai",
  }[status] || status;
}

function renderOrders(orders) {
  latestOrders = orders;
  const body = document.querySelector("#orders-body");
  if (!orders.length) {
    body.innerHTML = '<tr><td class="empty-state" colspan="8">Belum ada pesanan. Buat order pertama melalui menu Input Order Masuk.</td></tr>';
    return;
  }

  body.innerHTML = orders.map((order) => {
    const paid = paymentsTotal(order);
    const remaining = Math.max(Number(order.total_amount) - paid, 0);
    const customer = order.customers?.name || "Pelanggan";
    const items = Array.isArray(order.items) && order.items.length
      ? order.items
      : [{
        service_name: order.services?.name || "Layanan",
        shoe_type: order.shoe_type,
        shoe_brand: order.shoe_brand,
        shoe_size: order.shoe_size,
      }];
    const date = new Date(order.created_at).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const deliveryType = order.delivery_type || "pickup";
    const workflow = deliveryType === "delivery"
      ? ["received", "washing", "ready", "in_transit", "delivered"]
      : ["received", "washing", "ready", "delivered"];
    const currentStatus = order.status === "drying" ? "washing" : order.status;
    const currentIndex = workflow.indexOf(currentStatus);
    const visibleStatuses = currentStatus === "delivered" ? [currentStatus] : workflow.slice(currentIndex, currentIndex + 2);
    const statusOptions = visibleStatuses.map((status) =>
      `<option value="${status}" ${currentStatus === status ? "selected" : ""}>${status === "ready" && deliveryType === "delivery" ? "Siap Diantar" : statusLabel(status)}</option>`
    ).join("");
    const shoeDescription = items.map((item, index) => {
      const shoeTypeName = SHOE_TYPES.find((type) => type.id === item.shoe_type)?.name || item.shoe_type || "Jenis lain";
      const itemPrefix = items.length > 1 ? `${index + 1}. ` : "";
      return `<span class="shoe-detail">${itemPrefix}${escapeHtml(item.service_name || "Layanan")} · ${escapeHtml(shoeTypeName)} · ${escapeHtml(item.shoe_brand || "-")} · Uk. ${escapeHtml(item.shoe_size || "-")}</span>`;
    }).join("");
    const deliveryDescription = order.pickup_method === "home_pickup"
      ? `<span class="shoe-detail">Dijemput dan diantar: ${escapeHtml(order.delivery_address || "alamat belum dicatat")}</span>`
      : deliveryType === "delivery"
        ? `<span class="shoe-detail">${order.late_delivery ? "Antar tambahan" : "Diantar karyawan"}: ${escapeHtml(order.delivery_address || "alamat belum dicatat")}${Number(order.delivery_fee) ? ` · Biaya ${rupiah.format(Number(order.delivery_fee))}` : ""}</span>`
        : '<span class="shoe-detail">Pelanggan antar dan ambil di toko</span>';
    const storePickupBalance = isStorePickupBalanceOrder(order);
    const paymentAction = currentRole === "admin" && remaining > 0
      ? `<button class="pay-button" type="button" data-pay-id="${order.id}" data-remaining="${remaining}">${order.late_delivery ? "Bayar QRIS" : storePickupBalance ? "Catat pelunasan" : "Catat"}</button>`
      : currentRole === "admin" ? '<span aria-label="Lunas">—</span>' : "";
    const paymentStatus = order.late_delivery || storePickupBalance
      ? `<span class="payment-stage-label">${order.late_delivery ? "Pelunasan antar · QRIS" : "Pelunasan saat ambil (sisa maks. 30%)"}</span>${currentRole === "admin" ? `<select class="late-payment-status" data-payment-status-id="${escapeHtml(order.id)}" aria-label="Status pelunasan ${escapeHtml(order.order_number)}"><option value="unpaid" ${remaining > 0 ? "selected" : ""}>Belum lunas</option><option value="paid" ${remaining === 0 ? "selected" : ""}>Lunas</option></select>` : `<span class="badge ${remaining === 0 ? "badge-ready" : "badge-washing"}">${remaining === 0 ? "Lunas" : "Belum lunas"}</span>`}`
      : remaining === 0
      ? '<span class="badge badge-ready">Lunas</span>'
      : paid > 0
        ? '<span class="badge badge-washing">Uang muka</span>'
        : '<span class="badge badge-washing">Belum bayar</span>';
    const proofUrl = typeof order.delivery_proof === "string" &&
      /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(order.delivery_proof)
      ? order.delivery_proof
      : null;
    const proofCell = deliveryType !== "delivery"
      ? '<span class="proof-empty">Tidak perlu</span>'
      : proofUrl
        ? `<a class="proof-link" href="${proofUrl}" target="_blank" rel="noopener" aria-label="Lihat foto bukti pengantaran ${escapeHtml(order.order_number)}"><img src="${proofUrl}" alt=""><span>Lihat foto</span></a>`
        : order.status === "in_transit"
          ? `<button class="proof-upload-button" type="button" data-upload-proof-id="${escapeHtml(order.id)}">Unggah bukti & selesaikan</button>`
          : '<span class="proof-empty">Bukti foto diunggah saat pesanan sampai</span>';
    const statusCell = order.status === "delivered"
      ? `<span class="status-complete"><span aria-hidden="true">✓</span> ${statusLabel(order.status)}</span>`
      : `<select class="status-select badge-${order.status === "ready" ? "ready" : order.status === "washing" ? "washing" : order.status === "in_transit" ? "in-transit" : "received"}" data-status-id="${escapeHtml(order.id)}" aria-label="Status pesanan ${escapeHtml(order.order_number)}">${statusOptions}</select>`;
    const requestDeliveryAction = currentRole === "admin" && order.status === "ready" &&
      order.pickup_method === "store_dropoff" &&
      order.return_method === "self_pickup" &&
      !order.late_delivery
      ? `<button class="pay-button delivery-request-button" type="button" data-request-delivery-id="${escapeHtml(order.id)}">Minta antar</button>`
      : "";

    return `<tr>
      <td class="customer-cell"><strong>${escapeHtml(customer)}</strong><span>${escapeHtml(order.order_number)}</span></td>
      <td>${shoeDescription}${deliveryDescription}</td>
      <td>${date}</td>
      <td>${statusCell}</td>
      <td>${proofCell}</td>
      <td>${paymentStatus}<span class="shoe-detail">${remaining > 0 ? `${storePickupBalance ? "Uang muka tercatat" : "Terbayar"} ${rupiah.format(paid)} · ${storePickupBalance ? "pelunasan" : "sisa"} ${rupiah.format(remaining)}${order.late_delivery ? " termasuk ongkir · pelunasan melalui QRIS" : storePickupBalance ? " dibayar saat pengambilan di toko" : ""}` : storePickupBalance ? "Uang muka dan pelunasan sudah tercatat" : "Pembayaran lunas"}</span></td>
      <td class="money-cell"><strong>${rupiah.format(Number(order.total_amount))}</strong>${Number(order.delivery_fee) ? `<span>Termasuk antar ${rupiah.format(Number(order.delivery_fee))}</span>` : ""}<span>Sisa ${rupiah.format(remaining)}</span></td>
      <td><div class="order-actions">${requestDeliveryAction}${paymentAction}${currentRole === "admin" ? `<button class="delete-button" type="button" data-delete-id="${escapeHtml(order.id)}" aria-label="Hapus pesanan ${escapeHtml(order.order_number)}">Hapus</button>` : '<span aria-hidden="true">—</span>'}</div></td>
    </tr>`;
  }).join("");
}

function renderReport(orders) {
  const body = document.querySelector("#report-body");
  document.querySelector("#report-count").textContent = `${orders.length} order`;
  if (!orders.length) {
    body.innerHTML = '<tr><td class="empty-state" colspan="9">Belum ada riwayat transaksi.</td></tr>';
    return;
  }
  body.innerHTML = orders.map((order) => {
    const paid = paymentsTotal(order);
    const remaining = Math.max(Number(order.total_amount) - paid, 0);
    const paymentMethod = order.payments?.length
      ? order.payments.map((payment) => payment.payment_method).join(", ")
      : order.payment_method || "-";
    const customer = order.customers?.name || "Pelanggan";
    const items = Array.isArray(order.items) && order.items.length
      ? order.items
      : [{
        service_name: order.services?.name || "Layanan",
        shoe_type: order.shoe_type,
        shoe_brand: order.shoe_brand,
        shoe_size: order.shoe_size,
      }];
    const date = new Date(order.created_at).toLocaleDateString("id-ID");
    const storePickupBalance = isStorePickupBalanceOrder(order);
    const paymentStatus = remaining === 0
      ? "Lunas"
      : storePickupBalance && paid > 0
        ? "DP 70% · Pelunasan toko belum"
        : paid > 0
          ? "Uang muka"
          : "Belum Bayar";
    const shoeDetails = items.map((item, index) => {
      const shoeTypeName = SHOE_TYPES.find((type) => type.id === item.shoe_type)?.name || item.shoe_type || "-";
      const itemPrefix = items.length > 1 ? `${index + 1}. ` : "";
      return `<span class="shoe-detail">${itemPrefix}${escapeHtml(shoeTypeName)} · ${escapeHtml(item.shoe_brand || "-")} · Uk. ${escapeHtml(item.shoe_size || "-")}</span>`;
    }).join("");
    const serviceNames = [...new Set(items.map((item) => item.service_name || "Layanan"))];
    return `<tr>
      <td>${escapeHtml(order.order_number)}</td>
      <td>${date}</td>
      <td>${escapeHtml(customer)}<span class="shoe-detail">${escapeHtml(order.customers?.phone || "")}</span></td>
      <td>${shoeDetails}</td>
      <td>${serviceNames.map(escapeHtml).join(", ")}</td>
      <td>${rupiah.format(Number(order.total_amount))}${Number(order.delivery_fee) ? `<span class="shoe-detail">Termasuk biaya antar ${rupiah.format(Number(order.delivery_fee))}</span>` : ""}</td>
      <td><span class="badge ${remaining === 0 ? "badge-ready" : "badge-washing"}">${paymentStatus}</span><span class="shoe-detail">Sisa ${rupiah.format(remaining)}</span></td>
      <td>${escapeHtml(paymentMethod)}</td>
      <td>${statusLabel(order.status)}</td>
    </tr>`;
  }).join("");
}

function renderServices(services) {
  const body = document.querySelector("#services-body");
  if (!services.length) {
    body.innerHTML = '<tr><td class="empty-state" colspan="5">Belum ada layanan.</td></tr>';
    return;
  }
  body.innerHTML = services.map((service) => {
    const prices = SHOE_TYPES.map(({ id }) => Number(service.price_by_shoe_type?.[id] ?? service.price));
    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);
    const priceRange = lowest === highest
      ? rupiah.format(lowest)
      : `${rupiah.format(lowest)} – ${rupiah.format(highest)}`;
    return `<tr>
      <td>${escapeHtml(service.name)}</td>
      <td>${priceRange}</td>
      <td>${Number(service.estimated_days || 3)} hari</td>
      <td><span class="badge ${service.is_active ? "badge-ready" : "badge-delivered"}">${service.is_active ? "Aktif" : "Nonaktif"}</span></td>
      <td><button class="price-edit-button" type="button" data-edit-prices="${escapeHtml(service.id)}">Atur tarif</button></td>
    </tr>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function loadDashboard() {
  const [dashboard, orders] = await Promise.all([
    api("dashboard"),
    api("orders"),
  ]);
  const cashbook = await api("cashbook");
  document.querySelector("#cash-in").textContent = rupiah.format(dashboard.cash_in);
  document.querySelector("#cash-in-extra").textContent = rupiah.format(dashboard.cash_in);
  document.querySelector("#cash-out").textContent = rupiah.format(dashboard.cash_out);
  document.querySelector("#outstanding").textContent = rupiah.format(dashboard.outstanding);
  document.querySelector("#completed-orders").textContent = dashboard.completed_orders ?? orders.filter((order) => order.status === "delivered").length;
  document.querySelector("#active-orders").textContent = dashboard.active_orders ?? orders.filter((order) => order.status !== "delivered").length;
  renderOrders(orders);
  renderReport(orders);
  renderCashbook(cashbook);
  renderJournal(orders, cashbook);
}

async function loadOrders() {
  const orders = await api("orders");
  renderOrders(orders);
}

async function refreshWorkspaceData() {
  if (currentRole === "owner") {
    await loadDashboard();
  } else {
    await loadOrders();
  }
}

async function loadFormOptions() {
  const services = await api("services");
  serviceCatalog = services;
  renderShoeItems();
  updateOrderPricePreview(true);
  renderServices(services);
}

function renderShoeItems() {
  const serviceOptions = '<option value="">Pilih layanan</option>' +
    serviceCatalog.filter((service) => service.is_active).map((service) =>
      `<option value="${escapeHtml(service.id)}">${escapeHtml(service.name)}</option>`
    ).join("");
  const shoeTypeOptions = SHOE_TYPES.map(({ id, name }) =>
    `<option value="${id}">${escapeHtml(name)}</option>`
  ).join("");
  document.querySelector("#shoe-items-list").innerHTML = shoeItems.map((item, index) => `
    <article class="shoe-item-card" data-shoe-item="${index}">
      <div class="shoe-item-card-heading">
        <strong>Pasang ${index + 1}</strong>
        ${shoeItems.length > 1
          ? `<button class="remove-shoe-button" type="button" data-remove-shoe="${index}" aria-label="Hapus pasang ${index + 1}">Hapus</button>`
          : ""}
      </div>
      <label for="shoe-service-${index}">Layanan</label>
      <select class="shoe-item-service" id="shoe-service-${index}" data-shoe-field="service_id" required>${serviceOptions}</select>
      <label for="shoe-type-${index}">Jenis / bahan sepatu</label>
      <select class="shoe-item-type" id="shoe-type-${index}" data-shoe-field="shoe_type" required>${shoeTypeOptions}</select>
      <div class="shoe-item-other-field" hidden>
        <label for="shoe-type-other-${index}">Jenis / bahan sepatu lainnya</label>
        <input id="shoe-type-other-${index}" data-shoe-field="shoe_type_other" type="text" maxlength="20" placeholder="Contoh: Nubuck">
      </div>
      <div class="form-row">
        <div>
          <label for="shoe-brand-${index}">Merek sepatu</label>
          <input id="shoe-brand-${index}" data-shoe-field="shoe_brand" type="text" maxlength="80" placeholder="Contoh: Nike" required>
        </div>
        <div>
          <label for="shoe-size-${index}">Ukuran sepatu</label>
          <input id="shoe-size-${index}" data-shoe-field="shoe_size" type="text" maxlength="20" placeholder="Contoh: 42" required>
        </div>
      </div>
      <div class="shoe-item-price"><span>Tarif pasang ini</span><strong>Rp0</strong></div>
    </article>
  `).join("");

  document.querySelectorAll(".shoe-item-card").forEach((card, index) => {
    card.querySelector('[data-shoe-field="service_id"]').value = shoeItems[index].service_id;
    card.querySelector('[data-shoe-field="shoe_type"]').value = shoeItems[index].shoe_type;
    card.querySelector('[data-shoe-field="shoe_type_other"]').value = shoeItems[index].shoe_type_other;
    card.querySelector('[data-shoe-field="shoe_type_other"]').required = shoeItems[index].shoe_type === "other";
    card.querySelector(".shoe-item-other-field").hidden = shoeItems[index].shoe_type !== "other";
    card.querySelector('[data-shoe-field="shoe_brand"]').value = shoeItems[index].shoe_brand;
    card.querySelector('[data-shoe-field="shoe_size"]').value = shoeItems[index].shoe_size;
  });
  document.querySelector("#add-shoe-item").disabled = shoeItems.length >= 50;
  updateOrderPricePreview();
}

function getShoeItemPrice(item) {
  const service = serviceCatalog.find((entry) => entry.id === item.service_id && entry.is_active);
  const priceType = item.shoe_type === "other" ? "other" : item.shoe_type;
  const price = Number(service?.price_by_shoe_type?.[priceType]);
  return Number.isSafeInteger(price) && price >= 0 ? price : 0;
}

function updateOrderPricePreview(suggestMinimum = false) {
  const itemPrices = shoeItems.map(getShoeItemPrice);
  const serviceTotal = itemPrices.reduce((sum, price) => sum + price, 0);
  const pickupMethod = document.querySelector('input[name="pickup_method"]:checked')?.value || "store_dropoff";
  const returnMethod = document.querySelector('input[name="return_method"]:checked')?.value || "self_pickup";
  const isHomePickup = pickupMethod === "home_pickup";
  const deliveryFee = !isHomePickup && returnMethod === "employee_delivery" ? DELIVERY_FEE : 0;
  const total = serviceTotal + deliveryFee;
  const minimumPayment = isHomePickup
    ? total
    : itemPrices.reduce((sum, price) => sum + Math.ceil(price * 0.7), 0) + deliveryFee;
  const paymentInput = document.querySelector("#initial-payment");
  if (suggestMinimum) paymentInput.value = String(minimumPayment);

  document.querySelectorAll(".shoe-item-price strong").forEach((element, index) => {
    element.textContent = rupiah.format(itemPrices[index]);
  });
  document.querySelector("#order-price").textContent = rupiah.format(total);
  const deliveryFeeNote = document.querySelector("#delivery-fee-note");
  deliveryFeeNote.hidden = deliveryFee === 0;
  deliveryFeeNote.textContent = deliveryFee > 0
    ? `Termasuk biaya antar tetap ${rupiah.format(deliveryFee)} per pesanan (bukan per pasang).`
    : "";
  document.querySelector("#minimum-payment-help").textContent =
    isHomePickup
      ? `Wajib lunas 100% sebelum dijemput: ${rupiah.format(minimumPayment)}.`
      : `Minimal 70% dari tarif tiap pasang${deliveryFee ? ` + biaya antar ${rupiah.format(deliveryFee)}` : ""}: ${rupiah.format(minimumPayment)}.`;

  paymentInput.min = String(minimumPayment);
  paymentInput.max = String(total);
  const paid = Number(paymentInput.value || 0);
  const statusPreview = document.querySelector("#payment-status-preview");
  const statusLabel = document.querySelector("#payment-status-label");
  const statusDetail = document.querySelector("#payment-status-detail");
  if (total > 0 && paid >= total) {
    statusPreview.dataset.state = "paid";
    statusLabel.textContent = "Lunas";
    statusDetail.textContent = "Seluruh tagihan sudah dibayar.";
  } else if (paid >= minimumPayment && paid > 0) {
    statusPreview.dataset.state = "partial";
    statusLabel.textContent = "Uang muka cukup";
    statusDetail.textContent = `Sisa tagihan ${rupiah.format(Math.max(total - paid, 0))}.`;
  } else if (paid > 0) {
    statusPreview.dataset.state = "unpaid";
    statusLabel.textContent = "Uang muka kurang";
    statusDetail.textContent = `Tambahkan pembayaran hingga minimal ${rupiah.format(minimumPayment)}.`;
  } else {
    statusPreview.dataset.state = "unpaid";
    statusLabel.textContent = "Belum bayar";
    statusDetail.textContent = `Minimal pembayaran awal ${rupiah.format(minimumPayment)}.`;
  }
  paymentInput.setCustomValidity(paid < minimumPayment
    ? `Pembayaran awal minimal ${rupiah.format(minimumPayment)}.`
    : paid > total
      ? `Pembayaran tidak boleh melebihi total ${rupiah.format(total)}.`
      : "");
}

function orderItemsForSubmission() {
  return shoeItems.map((item) => ({
    service_id: item.service_id,
    shoe_type: item.shoe_type === "other" ? item.shoe_type_other.trim() : item.shoe_type,
    shoe_brand: item.shoe_brand.trim(),
    shoe_size: item.shoe_size.trim(),
  }));
  const paymentAmount = Number(document.querySelector("#initial-payment").value || 0);
  const statusPreview = document.querySelector("#payment-status-preview");
  const statusLabel = document.querySelector("#payment-status-label");
  const statusDetail = document.querySelector("#payment-status-detail");
  const remaining = Math.max(amount - paymentAmount, 0);

  if (amount > 0 && paymentAmount >= amount) {
    statusPreview.dataset.state = "paid";
    statusLabel.textContent = "Lunas";
    statusDetail.textContent = "Seluruh tagihan sudah dibayar.";
  } else if (paymentAmount > 0) {
    statusPreview.dataset.state = "partial";
    statusLabel.textContent = "Uang muka";
    statusDetail.textContent = `Sisa tagihan ${rupiah.format(remaining)}.`;
  } else {
    statusPreview.dataset.state = "unpaid";
    statusLabel.textContent = "Belum bayar";
    statusDetail.textContent = "Belum ada pembayaran yang dicatat.";
  }
}

function openPricingDialog(serviceId) {
  const service = serviceCatalog.find((item) => item.id === serviceId);
  if (!service) {
    showMessage(document.querySelector("#service-message"), "Layanan tidak ditemukan. Muat ulang data layanan.");
    return;
  }
  document.querySelector("#pricing-service-id").value = service.id;
  document.querySelector("#pricing-service-name").textContent = service.name;
  document.querySelector("#pricing-fields").innerHTML = SHOE_TYPES.map(({ id, name }) => {
    const value = Number(service.price_by_shoe_type?.[id] ?? service.price);
    return `<label class="price-field" for="price-${id}">
      <span>${name}</span>
      <span class="input-prefix"><span>Rp</span><input id="price-${id}" name="${id}" type="number" min="0" step="1000" value="${value}" required></span>
    </label>`;
  }).join("");
  showMessage(document.querySelector("#pricing-message"), "");
  document.querySelector("#pricing-dialog").showModal();
}

function renderCashbook(entries) {
  const body = document.querySelector("#cashbook-body");
  const total = entries.reduce((balance, entry) =>
    balance + (entry.entry_type === "income" ? Number(entry.amount) : -Number(entry.amount)), 0
  );
  document.querySelector("#cashbook-count").textContent = `${entries.length} transaksi`;
  document.querySelector("#cashbook-balance").textContent = rupiah.format(total);
  if (!entries.length) {
    body.innerHTML = '<tr><td class="empty-state" colspan="7">Belum ada transaksi kas. Pembayaran dan pengeluaran akan tercatat di sini.</td></tr>';
    return;
  }

  let runningBalance = 0;
  body.innerHTML = entries.map((entry) => {
    const isIncome = entry.entry_type === "income";
    const amount = Number(entry.amount);
    runningBalance += isIncome ? amount : -amount;
    const date = new Date(entry.entry_date).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const method = { cash: "Tunai", transfer: "Transfer", qris: "QRIS" }[entry.payment_method] || entry.payment_method;
    const amountText = rupiah.format(amount);
    return `<tr>
      <td>${date}</td>
      <td><span class="cashbook-type ${isIncome ? "income" : "expense"}">${isIncome ? "Masuk" : "Keluar"}</span></td>
      <td>${escapeHtml(entry.description)}</td>
      <td>${escapeHtml(entry.reference || "-")} · ${escapeHtml(method)}</td>
      <td class="cashbook-income">${isIncome ? amountText : "—"}</td>
      <td class="cashbook-expense">${isIncome ? "—" : amountText}</td>
      <td>${rupiah.format(runningBalance)}</td>
    </tr>`;
  }).join("");
}

function renderJournal(orders, cashbookEntries) {
  const body = document.querySelector("#journal-body");
  const journalEntries = [];
  let sequence = 0;
  const addEntry = (date, reference, description, account, debit, credit) => {
    journalEntries.push({
      date,
      reference,
      description,
      account,
      debit: Number(debit) || 0,
      credit: Number(credit) || 0,
      sequence: sequence++,
    });
  };
  const cashAccount = (method) => ({
    cash: "Kas Tunai",
    transfer: "Bank — Transfer",
    qris: "Bank — QRIS",
  }[method] || "Kas/Bank");

  orders.forEach((order) => {
    const total = Number(order.total_amount);
    const completedAt = order.completed_at || (order.status === "delivered" ? order.created_at : null);
    const completionTime = completedAt ? new Date(completedAt).getTime() : null;
    const paidBeforeCompletion = (order.payments || []).reduce((sum, payment) => {
      const paymentTime = new Date(payment.payment_date).getTime();
      const amount = Number(payment.amount);
      const isAdvance = completionTime === null || paymentTime <= completionTime;
      addEntry(
        payment.payment_date,
        order.order_number,
        `Pembayaran ${order.services?.name || "Laundry"} — ${order.customers?.name || "Pelanggan"}`,
        cashAccount(payment.payment_method),
        amount,
        0,
      );
      addEntry(
        payment.payment_date,
        order.order_number,
        `Pembayaran ${order.services?.name || "Laundry"} — ${order.customers?.name || "Pelanggan"}`,
        isAdvance ? "Uang Muka Pelanggan" : "Piutang Usaha",
        0,
        amount,
      );
      return isAdvance ? sum + amount : sum;
    }, 0);

    if (completionTime !== null) {
      const advance = Math.min(paidBeforeCompletion, total);
      const receivable = Math.max(total - advance, 0);
      const description = `Pengakuan pendapatan ${order.services?.name || "Laundry"} — ${order.customers?.name || "Pelanggan"}`;
      if (advance > 0) {
        addEntry(completedAt, order.order_number, description, "Uang Muka Pelanggan", advance, 0);
      }
      if (receivable > 0) {
        addEntry(completedAt, order.order_number, description, "Piutang Usaha", receivable, 0);
      }
      if (total > 0) {
        addEntry(completedAt, order.order_number, description, "Pendapatan Jasa Laundry", 0, total);
      }
    }
  });

  cashbookEntries.filter((entry) => entry.entry_type === "expense").forEach((entry) => {
    const [category] = entry.description.split(" · ", 1);
    const expenseAccount = {
      "Bahan & perlengkapan": "Beban Bahan & Perlengkapan",
      Operasional: "Beban Operasional",
      "Lain-lain": "Beban Lain-lain",
    }[category] || "Beban Lain-lain";
    addEntry(entry.entry_date, "-", entry.description, expenseAccount, entry.amount, 0);
    addEntry(entry.entry_date, "-", entry.description, cashAccount(entry.payment_method), 0, entry.amount);
  });

  journalEntries.sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime() || a.sequence - b.sequence
  );
  const totalDebit = journalEntries.reduce((sum, entry) => sum + entry.debit, 0);
  const totalCredit = journalEntries.reduce((sum, entry) => sum + entry.credit, 0);
  document.querySelector("#journal-count").textContent = `${journalEntries.length} baris jurnal`;
  document.querySelector("#journal-debit").textContent = rupiah.format(totalDebit);
  document.querySelector("#journal-credit").textContent = rupiah.format(totalCredit);
  const hasEstimatedDates = orders.some((order) => order.status === "delivered" && !order.completed_at);
  document.querySelector("#journal-date-note").hidden = !hasEstimatedDates;
  if (!journalEntries.length) {
    body.innerHTML = '<tr><td class="empty-state" colspan="6">Belum ada transaksi untuk dijurnal. Pembayaran, penyelesaian order, dan pengeluaran akan tercatat otomatis.</td></tr>';
    return;
  }
  body.innerHTML = journalEntries.map((entry) => {
    const date = new Date(entry.date).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `<tr>
      <td>${date}</td>
      <td>${escapeHtml(entry.reference)}</td>
      <td>${escapeHtml(entry.description)}</td>
      <td>${escapeHtml(entry.account)}</td>
      <td class="journal-amount">${entry.debit ? rupiah.format(entry.debit) : "—"}</td>
      <td class="journal-amount">${entry.credit ? rupiah.format(entry.credit) : "—"}</td>
    </tr>`;
  }).join("");
}

document.querySelector("#order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showMessage(formMessages.order, "");
  try {
    await api("orders", {
      method: "POST",
      body: JSON.stringify({
        customer_name: data.get("customer_name"),
        customer_phone: data.get("customer_phone"),
        items: orderItemsForSubmission(),
        initial_payment: Number(data.get("initial_payment") || 0),
        payment_method: data.get("payment_method"),
        pickup_method: data.get("pickup_method"),
        return_method: data.get("return_method"),
        delivery_address: data.get("delivery_address"),
        notes: data.get("notes"),
      }),
    });
    form.reset();
    shoeItems = [{ service_id: "", shoe_type: "canvas", shoe_type_other: "", shoe_brand: "", shoe_size: "" }];
    renderShoeItems();
    updateDeliveryOptions(true);
    showMessage(formMessages.order, "Pesanan berhasil disimpan.", true);
    await refreshWorkspaceData();
  } catch (error) {
    showMessage(formMessages.order, error.message);
  } finally {
    submitButton.disabled = false;
  }
});

const paymentDialog = document.querySelector("#payment-dialog");
const paymentForm = document.querySelector("#payment-form");
const deliveryRequestDialog = document.querySelector("#delivery-request-dialog");

document.querySelector("#close-delivery-request").addEventListener("click", () => deliveryRequestDialog.close());
document.querySelector("#cancel-delivery-request").addEventListener("click", () => deliveryRequestDialog.close());
document.querySelector("#delivery-request-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showMessage(document.querySelector("#delivery-request-message"), "");
  try {
    await api(`orders/${encodeURIComponent(document.querySelector("#delivery-request-order-id").value)}/delivery-request`, {
      method: "PATCH",
      body: JSON.stringify({
        delivery_address: document.querySelector("#delivery-request-address").value,
      }),
    });
    deliveryRequestDialog.close();
    showMessage(formMessages.ledger, "Pengantaran ditambahkan. Biaya Rp5.000 masuk ke sisa tagihan; pembayaran QRIS wajib lunas sebelum pengantaran.", true);
    await refreshWorkspaceData();
  } catch (error) {
    showMessage(document.querySelector("#delivery-request-message"), error.message);
  } finally {
    submitButton.disabled = false;
  }
});

function openPaymentDialog(order) {
  const remaining = Math.max(Number(order.total_amount) - paymentsTotal(order), 0);
  const storePickupBalance = isStorePickupBalanceOrder(order);
  const amountInput = document.querySelector("#payment-amount");
  const methodSelect = document.querySelector("#payment-method-entry");
  const paymentHelp = document.querySelector("#payment-help");
  document.querySelector("#payment-submit-button").textContent = storePickupBalance
    ? "Catat pelunasan"
    : "Simpan pembayaran";
  document.querySelector("#payment-dialog-title").textContent = storePickupBalance
    ? "Catat pelunasan saat pengambilan"
    : "Catat pembayaran";
  document.querySelector("#payment-order-id").value = order.id;
  amountInput.max = remaining;
  amountInput.value = remaining;
  amountInput.readOnly = Boolean(order.late_delivery);
  methodSelect.disabled = Boolean(order.late_delivery);
  methodSelect.value = order.late_delivery ? "qris" : "cash";
  methodSelect.querySelectorAll("option").forEach((option) => {
    option.hidden = Boolean(order.late_delivery && option.value !== "qris");
  });
  paymentHelp.hidden = !order.late_delivery && !storePickupBalance;
  paymentHelp.textContent = order.late_delivery
    ? `Pembayaran tambahan hanya melalui QRIS. Untuk status Lunas, bayar ${rupiah.format(remaining)} termasuk ongkir.`
    : storePickupBalance
      ? `Pembayaran awal minimal 70% sudah dicatat. Catat sisa ${rupiah.format(remaining)} saat pelanggan mengambil sepatu di toko. Status berubah menjadi Lunas setelah seluruh sisa tagihan dibayar.`
      : "";
  showMessage(document.querySelector("#payment-message"), "");
  paymentDialog.showModal();
}

document.querySelector("#orders-body").addEventListener("click", (event) => {
  const button = event.target.closest("[data-pay-id]");
  if (button) {
    const order = latestOrders.find((item) => item.id === button.dataset.payId);
    if (order) openPaymentDialog(order);
    return;
  }
  const deliveryButton = event.target.closest("[data-request-delivery-id]");
  if (deliveryButton) {
    document.querySelector("#delivery-request-order-id").value = deliveryButton.dataset.requestDeliveryId;
    document.querySelector("#delivery-request-address").value = "";
    showMessage(document.querySelector("#delivery-request-message"), "");
    deliveryRequestDialog.showModal();
    return;
  }
  const proofButton = event.target.closest("[data-upload-proof-id]");
  if (proofButton) {
    openDeliveryProofDialog(proofButton.dataset.uploadProofId);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-id]");
  if (deleteButton) deleteOrder(deleteButton.dataset.deleteId, deleteButton);
});

async function deleteOrder(orderId, button) {
  const order = latestOrders.find((item) => item.id === orderId);
  if (!order) {
    showMessage(formMessages.ledger, "Pesanan tidak ditemukan. Muat ulang daftar pesanan.");
    return;
  }
  const paymentCount = order.payments?.length || 0;
  const warning = paymentCount
    ? `Pesanan ${order.order_number} memiliki ${paymentCount} catatan pembayaran. Hapus pesanan dan seluruh pembayaran terkait? Tindakan ini tidak dapat dibatalkan.`
    : `Hapus pesanan ${order.order_number}? Tindakan ini tidak dapat dibatalkan.`;
  if (!window.confirm(warning)) return;

  button.disabled = true;
  try {
    await api(`orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
    showMessage(formMessages.ledger, "Pesanan berhasil dihapus.", true);
    await refreshWorkspaceData();
  } catch (error) {
    showMessage(formMessages.ledger, error.message);
    await refreshWorkspaceData();
  } finally {
    button.disabled = false;
  }
}

document.querySelector("#orders-body").addEventListener("change", async (event) => {
  const paymentStatus = event.target.closest("[data-payment-status-id]");
  if (paymentStatus) {
    const order = latestOrders.find((item) => item.id === paymentStatus.dataset.paymentStatusId);
    if (!order) return;
    if (paymentStatus.value === "paid" && paymentsTotal(order) < Number(order.total_amount)) {
      paymentStatus.value = "unpaid";
      openPaymentDialog(order);
    } else {
      paymentStatus.value = paymentsTotal(order) >= Number(order.total_amount) ? "paid" : "unpaid";
    }
    return;
  }
  const select = event.target.closest("[data-status-id]");
  if (!select) return;
  const selectedOrder = latestOrders.find((order) => order.id === select.dataset.statusId);
  if (selectedOrder?.delivery_type === "delivery" && select.value === "delivered") {
    openDeliveryProofDialog(select.dataset.statusId);
    return;
  }
  await updateOrderStatus(select.dataset.statusId, select.value, select);
});

function openDeliveryProofDialog(orderId) {
  document.querySelector("#proof-order-id").value = orderId;
  document.querySelector("#proof-file").value = "";
  showMessage(document.querySelector("#proof-message"), "");
  document.querySelector("#delivery-proof-dialog").showModal();
}

async function updateOrderStatus(orderId, status, select, deliveryProof = null) {
  if (select) select.disabled = true;
  try {
    await api(`orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...(deliveryProof ? { delivery_proof: deliveryProof } : {}) }),
    });
    showMessage(formMessages.ledger, "Status pesanan berhasil diperbarui.", true);
    await refreshWorkspaceData();
    return true;
  } catch (error) {
    showMessage(formMessages.ledger, error.message);
    await refreshWorkspaceData();
    return false;
  } finally {
    if (select) select.disabled = false;
  }
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Foto bukti tidak dapat dibaca.")));
    reader.readAsDataURL(file);
  });
}

const proofDialog = document.querySelector("#delivery-proof-dialog");
document.querySelector("#close-proof").addEventListener("click", () => proofDialog.close());
document.querySelector("#cancel-proof").addEventListener("click", () => proofDialog.close());
document.querySelector("#delivery-proof-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = document.querySelector("#proof-file").files[0];
  if (!file) {
    showMessage(document.querySelector("#proof-message"), "Pilih foto bukti pengantaran.");
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    showMessage(document.querySelector("#proof-message"), "Pilih foto JPG, PNG, WEBP, atau GIF maksimal 5 MB.");
    return;
  }
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showMessage(document.querySelector("#proof-message"), "");
  try {
    const image = await readImageAsDataUrl(file);
    const updated = await updateOrderStatus(
      document.querySelector("#proof-order-id").value,
      "delivered",
      null,
      image,
    );
    if (updated) proofDialog.close();
  } catch (error) {
    showMessage(document.querySelector("#proof-message"), error.message);
  } finally {
    submitButton.disabled = false;
  }
});

function closePaymentDialog() {
  paymentDialog.close();
  document.querySelector("#payment-dialog-title").textContent = "Catat pembayaran";
  document.querySelector("#payment-submit-button").textContent = "Simpan pembayaran";
  document.querySelector("#payment-amount").readOnly = false;
  document.querySelector("#payment-method-entry").disabled = false;
  document.querySelector("#payment-method-entry").querySelectorAll("option").forEach((option) => {
    option.hidden = false;
  });
  document.querySelector("#payment-help").hidden = true;
}

document.querySelector("#close-payment").addEventListener("click", closePaymentDialog);
document.querySelector("#cancel-payment").addEventListener("click", closePaymentDialog);

paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = paymentForm.querySelector('button[type="submit"]');
  const amount = Number(document.querySelector("#payment-amount").value);
  const paymentOrder = latestOrders.find((order) =>
    order.id === document.querySelector("#payment-order-id").value
  );
  const isPickupSettlement = paymentOrder && isStorePickupBalanceOrder(paymentOrder);
  submitButton.disabled = true;
  showMessage(document.querySelector("#payment-message"), "");
  try {
    await api("payments", {
      method: "POST",
      body: JSON.stringify({
        order_id: document.querySelector("#payment-order-id").value,
        amount,
        payment_method: document.querySelector("#payment-method-entry").value,
      }),
    });
    closePaymentDialog();
    showMessage(
      formMessages.ledger,
      isPickupSettlement ? "Pembayaran pelunasan saat pengambilan berhasil dicatat." : "Pembayaran berhasil dicatat.",
      true,
    );
    await refreshWorkspaceData();
  } catch (error) {
    showMessage(document.querySelector("#payment-message"), error.message);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#today").textContent = new Date().toLocaleDateString("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function renderNavigation(role) {
  const navigation = document.querySelector("#role-navigation");
  navigation.innerHTML = ROLE_PAGES[role].map((page) =>
    `<a class="nav-link" href="#${page.id}"><span aria-hidden="true">${page.icon}</span>${page.label}</a>`
  ).join("");
}

function updateActiveNavigation() {
  if (!currentRole) return;
  const allowedPages = ROLE_PAGES[currentRole];
  const requestedPage = window.location.hash.slice(1);
  const page = allowedPages.find((item) => item.id === requestedPage) || allowedPages[0];
  if (page.id !== requestedPage) history.replaceState(null, "", `#${page.id}`);
  document.querySelectorAll("[data-page]").forEach((view) => {
    view.classList.toggle("active-page", view.dataset.page === page.id);
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${page.id}`);
  });
  document.querySelector("#current-page").textContent = page.label;
}

function showWorkspace(username, role) {
  currentRole = role;
  document.querySelector("#app-shell").classList.toggle("role-admin", role === "admin");
  document.querySelector("#app-shell").classList.toggle("role-owner", role === "owner");
  document.querySelector("#login-screen").hidden = true;
  document.querySelector("#app-shell").hidden = false;
  document.querySelector("#role-badge").textContent = role === "admin" ? "ADMIN" : "OWNER";
  document.querySelector("#role-badge").classList.toggle("admin", role === "admin");
  document.querySelector("#workspace-eyebrow").textContent =
    role === "admin" ? "T-STEP LAB · ORDER CARE" : "T-STEP LAB · BUSINESS OVERVIEW";
  document.querySelector("#workspace-title").textContent =
    role === "admin" ? "Setiap sepatu, terawat dengan teliti." : "Bisnis terpantau, keputusan lebih yakin.";
  document.querySelector("#workspace-subtitle").textContent =
    role === "admin"
      ? "Atur pesanan dan berikan perawatan terbaik di setiap langkah."
      : "Satu ruang untuk melihat performa dan mengelola shoe-care Anda.";
  document.querySelector(".sidebar-footer").innerHTML =
    `<span class="status-dot"></span> Masuk sebagai ${role === "admin" ? "Admin" : "Owner"}`;
  document.querySelector(".sidebar-note strong").innerHTML =
    role === "admin" ? "Operasional rapi,<br>pesanan lancar." : "Pantau bisnis,<br>ambil keputusan.";
  document.querySelector(".sidebar-note p").textContent =
    role === "admin"
      ? "Catat order, atur antrean, dan kelola pembayaran."
      : "Lihat performa, laporan transaksi, dan layanan.";
  renderNavigation(role);
  const allowedPages = ROLE_PAGES[role].map((page) => page.id);
  const requestedPage = window.location.hash.slice(1);
  const page = allowedPages.includes(requestedPage) ? requestedPage : allowedPages[0];
  if (window.location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
  updateActiveNavigation();
  loadWorkspaceData();
}

async function loadWorkspaceData() {
  try {
    await Promise.all([refreshWorkspaceData(), loadFormOptions()]);
  } catch (error) {
    showMessage(formMessages.ledger, error.message);
    document.querySelector("#orders-body").innerHTML =
      '<tr><td class="empty-state" colspan="8">Tidak dapat memuat data. Periksa koneksi backend dan Supabase.</td></tr>';
    document.querySelector("#report-body").innerHTML =
      '<tr><td class="empty-state" colspan="9">Laporan tidak dapat dimuat. Periksa koneksi data.</td></tr>';
    document.querySelector("#cashbook-body").innerHTML =
      '<tr><td class="empty-state" colspan="7">Buku kas tidak dapat dimuat. Periksa koneksi data.</td></tr>';
    document.querySelector("#journal-body").innerHTML =
      '<tr><td class="empty-state" colspan="6">Jurnal tidak dapat dimuat. Periksa koneksi data.</td></tr>';
  }
}

async function endSession() {
  let logoutError;
  try {
    await api("logout", { method: "POST" });
  } catch (error) {
    logoutError = error;
  }
  sessionStorage.removeItem("t-step-lab-user");
  sessionStorage.removeItem("t-step-lab-role");
  sessionStorage.removeItem("t-step-api-token");
  currentRole = "";
  document.querySelector("#app-shell").hidden = true;
  document.querySelector("#login-screen").hidden = false;
  document.querySelector("#login-form").reset();
  history.replaceState(null, "", window.location.pathname);
  showMessage(
    document.querySelector("#login-message"),
    logoutError ? `Sesi lokal ditutup, tetapi logout server gagal: ${logoutError.message}` : ""
  );
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.querySelector("#login-username").value.trim();
  const password = document.querySelector("#login-password").value;
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showMessage(document.querySelector("#login-message"), "");
  try {
    if (!await checkBackendConnection()) {
      throw new Error("Supabase belum terhubung. Pastikan backend online dan database dapat dijangkau.");
    }
    const account = await api("login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (typeof account.token !== "string" || !account.token) {
      throw new Error("Backend tidak mengirim token sesi. Periksa konfigurasi server.");
    }
    sessionStorage.setItem("t-step-api-token", account.token);
    sessionStorage.setItem("t-step-lab-user", account.username);
    sessionStorage.setItem("t-step-lab-role", account.role);
    showWorkspace(account.username, account.role);
  } catch (error) {
    showMessage(document.querySelector("#login-message"), error.message);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", () => endSession());
window.addEventListener("hashchange", updateActiveNavigation);

function updateDeliveryOptions(suggestMinimum = true) {
  const pickupMethod = document.querySelector('input[name="pickup_method"]:checked')?.value || "store_dropoff";
  const returnMethod = document.querySelector('input[name="return_method"]:checked')?.value || "self_pickup";
  const isHomePickup = pickupMethod === "home_pickup";
  const needsAddress = isHomePickup || returnMethod === "employee_delivery";
  document.querySelector("#return-method-field").hidden = isHomePickup;
  document.querySelector("#delivery-address-field").hidden = !needsAddress;
  document.querySelector("#delivery-address").required = needsAddress;
  document.querySelector('label[for="delivery-address"]').textContent = isHomePickup
    ? "Alamat rumah untuk penjemputan dan pengantaran"
    : "Alamat pengantaran";
  updateOrderPricePreview(suggestMinimum);
}

document.querySelectorAll('input[name="pickup_method"], input[name="return_method"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    updateDeliveryOptions();
  });
});

document.querySelector("#initial-payment").addEventListener("input", () => updateOrderPricePreview());
document.querySelector("#add-shoe-item").addEventListener("click", () => {
  if (shoeItems.length >= 50) return;
  shoeItems.push({ service_id: "", shoe_type: "canvas", shoe_type_other: "", shoe_brand: "", shoe_size: "" });
  renderShoeItems();
  updateOrderPricePreview(true);
});
document.querySelector("#shoe-items-list").addEventListener("input", (event) => {
  const field = event.target.closest("[data-shoe-field]");
  if (!field) return;
  const card = field.closest("[data-shoe-item]");
  const index = Number(card.dataset.shoeItem);
  shoeItems[index][field.dataset.shoeField] = field.value;
  updateOrderPricePreview();
});
document.querySelector("#shoe-items-list").addEventListener("change", (event) => {
  const field = event.target.closest("[data-shoe-field]");
  if (field) {
    const card = field.closest("[data-shoe-item]");
    const index = Number(card.dataset.shoeItem);
    shoeItems[index][field.dataset.shoeField] = field.value;
    if (field.dataset.shoeField === "shoe_type") {
      const customTypeInput = card.querySelector('[data-shoe-field="shoe_type_other"]');
      const isOther = field.value === "other";
      card.querySelector(".shoe-item-other-field").hidden = !isOther;
      customTypeInput.required = isOther;
      if (!isOther) {
        customTypeInput.value = "";
        shoeItems[index].shoe_type_other = "";
      }
    }
    updateOrderPricePreview(field.dataset.shoeField === "service_id" || field.dataset.shoeField === "shoe_type");
  }
});
document.querySelector("#shoe-items-list").addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-shoe]");
  if (removeButton) {
    shoeItems.splice(Number(removeButton.dataset.removeShoe), 1);
    renderShoeItems();
    updateOrderPricePreview(true);
  }
});

document.querySelector("#service-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  showMessage(document.querySelector("#service-message"), "");
  try {
    await api("services", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        price: Number(data.get("price")),
        price_by_shoe_type: defaultPriceMap(Number(data.get("price"))),
        estimated_days: Number(data.get("estimated_days")),
      }),
    });
    form.reset();
    showMessage(document.querySelector("#service-message"), "Layanan berhasil ditambahkan.", true);
    await loadFormOptions();
  } catch (error) {
    showMessage(document.querySelector("#service-message"), error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#services-body").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-prices]");
  if (button) openPricingDialog(button.dataset.editPrices);
});

const pricingDialog = document.querySelector("#pricing-dialog");
document.querySelector("#close-pricing").addEventListener("click", () => pricingDialog.close());
document.querySelector("#cancel-pricing").addEventListener("click", () => pricingDialog.close());
document.querySelector("#pricing-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const prices = Object.fromEntries(SHOE_TYPES.map(({ id }) => [id, Number(formData.get(id))]));
  submitButton.disabled = true;
  showMessage(document.querySelector("#pricing-message"), "");
  try {
    const service = await api(`services/${encodeURIComponent(document.querySelector("#pricing-service-id").value)}/prices`, {
      method: "PATCH",
      body: JSON.stringify({ price_by_shoe_type: prices }),
    });
    pricingDialog.close();
    showMessage(document.querySelector("#service-message"), `Tarif ${service.name} berhasil diperbarui.`, true);
    await loadFormOptions();
  } catch (error) {
    showMessage(document.querySelector("#pricing-message"), error.message);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#expense-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showMessage(formMessages.expense, "");
  try {
    await api("expenses", {
      method: "POST",
      body: JSON.stringify({
        description: data.get("description"),
        category: data.get("category"),
        amount: Number(data.get("amount")),
        payment_method: data.get("payment_method"),
      }),
    });
    form.reset();
    showMessage(formMessages.expense, "Pengeluaran berhasil dicatat di buku kas.", true);
    await refreshWorkspaceData();
  } catch (error) {
    showMessage(formMessages.expense, error.message);
  } finally {
    submitButton.disabled = false;
  }
});

const existingUsername = sessionStorage.getItem("t-step-lab-user");
sessionStorage.removeItem("t-step-lab-user");
sessionStorage.removeItem("t-step-lab-role");
sessionStorage.removeItem("t-step-api-token");
if (existingUsername || window.location.hash) {
  history.replaceState(null, "", window.location.pathname);
}
setConnectionStatus(false);
checkBackendConnection();
