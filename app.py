import hmac
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st


APP_TITLE = "T-Step Lab | Laundry Sepatu"
DATABASE_PATH = Path(__file__).with_name("t_step_lab.db")
DEFAULT_SERVICES = (
    ("Deep Clean", 50000),
    ("Fast Clean", 30000),
    ("Unyellowing", 75000),
    ("Repaint", 100000),
)
PAYMENT_METHODS = ("Tunai", "QRIS")
PAYMENT_STATUSES = ("Belum Bayar", "Lunas")
PICKUP_STATUSES = ("Antrean", "Sedang Dicuci", "Siap Diambil", "Selesai")
DELIVERY_STATUSES = (
    "Antrean",
    "Sedang Dicuci",
    "Dalam Perjalanan Pengantaran",
    "Selesai",
)
CATEGORIES = {
    "supplies": "Bahan & perlengkapan",
    "operations": "Operasional",
    "other": "Lain-lain",
}

# Demo credentials; replace these with proper password hashing before deployment.
ACCOUNTS = {
    "admin@tsteplab.com": {"password": "admin123", "role": "admin"},
    "owner@tsteplab.com": {"password": "owner123", "role": "owner"},
}

st.set_page_config(
    page_title=APP_TITLE,
    page_icon="👟",
    layout="wide",
    initial_sidebar_state="expanded",
)


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def db_connection():
    connection = get_connection()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    with db_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                price INTEGER NOT NULL CHECK (price >= 0),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_number TEXT NOT NULL UNIQUE,
                customer_name TEXT NOT NULL,
                customer_whatsapp TEXT NOT NULL,
                service_id INTEGER NOT NULL REFERENCES services(id),
                shoe_brand TEXT NOT NULL,
                shoe_size TEXT NOT NULL,
                shoe_condition TEXT NOT NULL DEFAULT '',
                estimated_cost INTEGER NOT NULL CHECK (estimated_cost >= 0),
                payment_status TEXT NOT NULL
                    CHECK (payment_status IN ('Belum Bayar', 'Lunas')),
                payment_method TEXT NOT NULL
                    CHECK (payment_method IN ('Tunai', 'QRIS')),
                delivery_type TEXT NOT NULL
                    CHECK (delivery_type IN ('Diambil di Toko', 'Diantar ke Alamat')),
                delivery_address TEXT NOT NULL DEFAULT '',
                wash_status TEXT NOT NULL DEFAULT 'Antrean',
                delivery_proof BLOB,
                delivery_proof_name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cash_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER REFERENCES orders(id),
                transaction_type TEXT NOT NULL
                    CHECK (transaction_type IN ('income', 'expense')),
                amount INTEGER NOT NULL CHECK (amount > 0),
                description TEXT NOT NULL,
                category TEXT,
                payment_method TEXT NOT NULL
                    CHECK (payment_method IN ('Tunai', 'QRIS')),
                transaction_date TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS orders_created_at_idx
                ON orders(created_at DESC);
            CREATE INDEX IF NOT EXISTS cash_transactions_date_idx
                ON cash_transactions(transaction_date, id);
            """
        )
        for name, price in DEFAULT_SERVICES:
            connection.execute(
                """
                INSERT OR IGNORE INTO services (name, price, created_at)
                VALUES (?, ?, ?)
                """,
                (name, price, datetime.now().isoformat(timespec="seconds")),
            )


def query_all(sql, parameters=()):
    with db_connection() as connection:
        return connection.execute(sql, parameters).fetchall()


def query_one(sql, parameters=()):
    with db_connection() as connection:
        return connection.execute(sql, parameters).fetchone()


def format_rupiah(amount):
    return f"Rp {int(amount or 0):,}".replace(",", ".")


def sync_order_price(service_options):
    selected_service = st.session_state.get("order_service")
    if selected_service in service_options:
        st.session_state["order_estimated_cost"] = int(
            service_options[selected_service]["price"]
        )


def add_order(
    customer_name,
    customer_whatsapp,
    service_id,
    shoe_brand,
    shoe_size,
    shoe_condition,
    estimated_cost,
    payment_status,
    payment_method,
    delivery_type,
    delivery_address,
):
    now = datetime.now().isoformat(timespec="seconds")
    order_number = f"TS-{datetime.now():%Y%m%d}-{uuid.uuid4().hex[:6].upper()}"
    with db_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO orders (
                order_number, customer_name, customer_whatsapp, service_id,
                shoe_brand, shoe_size, shoe_condition, estimated_cost,
                payment_status, payment_method, delivery_type,
                delivery_address, wash_status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Antrean', ?, ?)
            """,
            (
                order_number,
                customer_name.strip(),
                customer_whatsapp.strip(),
                service_id,
                shoe_brand.strip(),
                shoe_size.strip(),
                shoe_condition.strip(),
                estimated_cost,
                payment_status,
                payment_method,
                delivery_type,
                delivery_address.strip(),
                now,
                now,
            ),
        )
        order_id = cursor.lastrowid
        if payment_status == "Lunas":
            connection.execute(
                """
                INSERT INTO cash_transactions (
                    order_id, transaction_type, amount, description,
                    payment_method, transaction_date
                )
                VALUES (?, 'income', ?, ?, ?, ?)
                """,
                (
                    order_id,
                    estimated_cost,
                    f"Pembayaran pesanan {order_number}",
                    payment_method,
                    now,
                ),
            )
    return order_number


def get_orders():
    return query_all(
        """
        SELECT orders.*, services.name AS service_name
        FROM orders
        JOIN services ON services.id = orders.service_id
        ORDER BY orders.created_at DESC, orders.id DESC
        """
    )


def update_wash_status(order_id, next_status, proof_file=None):
    order = query_one("SELECT * FROM orders WHERE id = ?", (order_id,))
    if not order:
        raise ValueError("Pesanan tidak ditemukan.")

    workflow = DELIVERY_STATUSES if order["delivery_type"] == "Diantar ke Alamat" else PICKUP_STATUSES
    current_index = workflow.index(order["wash_status"])
    if current_index + 1 >= len(workflow) or workflow[current_index + 1] != next_status:
        raise ValueError("Perubahan status tidak sesuai urutan proses.")

    proof_bytes = proof_file.getvalue() if proof_file else None
    proof_name = proof_file.name if proof_file else None
    now = datetime.now().isoformat(timespec="seconds")
    with db_connection() as connection:
        if proof_bytes:
            connection.execute(
                """
                UPDATE orders
                SET wash_status = ?, delivery_proof = ?, delivery_proof_name = ?, updated_at = ?
                WHERE id = ?
                """,
                (next_status, proof_bytes, proof_name, now, order_id),
            )
        else:
            connection.execute(
                "UPDATE orders SET wash_status = ?, updated_at = ? WHERE id = ?",
                (next_status, now, order_id),
            )


def settle_order(order_id, payment_method):
    now = datetime.now().isoformat(timespec="seconds")
    with db_connection() as connection:
        order = connection.execute(
            "SELECT * FROM orders WHERE id = ?", (order_id,)
        ).fetchone()
        if not order:
            raise ValueError("Pesanan tidak ditemukan.")
        if order["payment_status"] == "Lunas":
            return
        connection.execute(
            """
            UPDATE orders
            SET payment_status = 'Lunas', payment_method = ?, updated_at = ?
            WHERE id = ?
            """,
            (payment_method, now, order_id),
        )
        connection.execute(
            """
            INSERT INTO cash_transactions (
                order_id, transaction_type, amount, description,
                payment_method, transaction_date
            )
            VALUES (?, 'income', ?, ?, ?, ?)
            """,
            (
                order_id,
                order["estimated_cost"],
                f"Pelunasan pesanan {order['order_number']}",
                payment_method,
                now,
            ),
        )


def add_expense(description, category, amount, payment_method):
    with db_connection() as connection:
        connection.execute(
            """
            INSERT INTO cash_transactions (
                transaction_type, amount, description, category,
                payment_method, transaction_date
            )
            VALUES ('expense', ?, ?, ?, ?, ?)
            """,
            (
                amount,
                description.strip(),
                category,
                payment_method,
                datetime.now().isoformat(timespec="seconds"),
            ),
        )


def login_page():
    st.title("T-Step Lab")
    st.subheader("Sistem Operasional Laundry Sepatu")
    st.write("Masuk menggunakan akun Admin atau Owner.")
    with st.form("login_form"):
        username = st.text_input("Email akun")
        password = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Login", type="primary", use_container_width=True)
    if submitted:
        normalized_username = username.strip().lower()
        account = ACCOUNTS.get(normalized_username)
        if account and hmac.compare_digest(password, account["password"]):
            st.session_state["is_logged_in"] = True
            st.session_state["username"] = "admin@TStepLab.com" if account["role"] == "admin" else "owner@TStepLab.com"
            st.session_state["role"] = account["role"]
            st.rerun()
        st.error("Username atau password salah.")
    st.caption("Akun: admin@TStepLab.com / admin123 atau owner@TStepLab.com / owner123.")


def sidebar_menu(role):
    with st.sidebar:
        st.title("T-Step Lab")
        st.caption(f"Masuk sebagai **{st.session_state['username']}** · {role.title()}")
        if role == "admin":
            pages = ("Input Order Masuk", "Status Antrean & Kasir")
        else:
            pages = (
                "Dashboard Ringkasan",
                "Laporan Transaksi",
                "Buku Kas",
                "Kelola Layanan & Harga",
            )
        selected_page = st.radio("Menu", pages, label_visibility="collapsed")
        st.divider()
        if st.button("Logout", use_container_width=True):
            for key in ("is_logged_in", "username", "role"):
                st.session_state.pop(key, None)
            st.rerun()
    return selected_page


def order_input_page():
    st.title("Input Order Masuk")
    st.write("Isi data pelanggan dan sepatu. Order baru otomatis masuk ke status Antrean.")
    services = query_all(
        "SELECT id, name, price FROM services WHERE is_active = 1 ORDER BY name"
    )
    if not services:
        st.warning("Belum ada layanan aktif. Minta Owner menambahkan layanan terlebih dahulu.")
        return

    service_options = {f"{row['name']} · {format_rupiah(row['price'])}": row for row in services}
    default_service = next(iter(service_options))
    if st.session_state.get("order_service") not in service_options:
        st.session_state["order_service"] = default_service
        st.session_state["order_estimated_cost"] = int(service_options[default_service]["price"])
    service_label = st.selectbox(
        "Jenis Layanan",
        list(service_options),
        key="order_service",
        on_change=sync_order_price,
        args=(service_options,),
    )
    delivery_type = st.radio(
        "Metode Penyerahan",
        ("Diambil di Toko", "Diantar ke Alamat"),
        horizontal=True,
    )
    delivery_address = ""
    if delivery_type == "Diantar ke Alamat":
        delivery_address = st.text_area(
            "Alamat Rumah / Kost",
            placeholder="Masukkan alamat lengkap dan patokan.",
        )

    with st.form("new_order_form", clear_on_submit=True):
        customer_name = st.text_input("Nama Pelanggan")
        customer_whatsapp = st.text_input("Nomor WhatsApp", placeholder="Contoh: 081234567890")
        shoe_brand = st.text_input("Merek Sepatu", placeholder="Contoh: Nike")
        shoe_size = st.text_input("Ukuran Sepatu", placeholder="Contoh: 42")
        shoe_condition = st.text_area(
            "Catatan Kondisi Sepatu",
            placeholder="Jelaskan noda, kerusakan, atau kondisi khusus sepatu.",
        )
        estimated_cost = st.number_input(
            "Estimasi Biaya (Rp)",
            min_value=1,
            step=5000,
            value=int(service_options[service_label]["price"]),
            key="order_estimated_cost",
        )
        first_column, second_column = st.columns(2)
        with first_column:
            payment_status = st.selectbox("Status Pembayaran", PAYMENT_STATUSES)
        with second_column:
            payment_method = st.selectbox("Pembayaran", PAYMENT_METHODS)
        submitted = st.form_submit_button("Simpan Order", type="primary", use_container_width=True)

    if submitted:
        if not customer_name.strip() or not customer_whatsapp.strip():
            st.error("Nama pelanggan dan nomor WhatsApp wajib diisi.")
        elif not shoe_brand.strip() or not shoe_size.strip():
            st.error("Merek dan ukuran sepatu wajib diisi.")
        elif delivery_type == "Diantar ke Alamat" and not delivery_address.strip():
            st.error("Alamat wajib diisi untuk pesanan yang diantar.")
        elif payment_status == "Lunas" and estimated_cost <= 0:
            st.error("Biaya pesanan harus lebih dari Rp0 untuk pembayaran lunas.")
        else:
            order_number = add_order(
                customer_name,
                customer_whatsapp,
                service_options[service_label]["id"],
                shoe_brand,
                shoe_size,
                shoe_condition,
                int(estimated_cost),
                payment_status,
                payment_method,
                delivery_type,
                delivery_address,
            )
            st.success(f"Order {order_number} berhasil disimpan dengan status Antrean.")


def order_status_page():
    st.title("Status Antrean & Kasir")
    orders = get_orders()
    if not orders:
        st.info("Belum ada order masuk.")
        return

    st.caption(f"{len(orders)} sepatu tercatat")
    for order in orders:
        with st.expander(
            f"{order['order_number']} · {order['customer_name']} · "
            f"{order['shoe_brand']} ukuran {order['shoe_size']} · {order['wash_status']}",
            expanded=order["wash_status"] != "Selesai",
        ):
            information, payment = st.columns([2, 1])
            with information:
                st.write(f"**Layanan:** {order['service_name']}")
                st.write(f"**WhatsApp:** {order['customer_whatsapp']}")
                st.write(f"**Biaya:** {format_rupiah(order['estimated_cost'])}")
                st.write(f"**Metode penyerahan:** {order['delivery_type']}")
                if order["delivery_type"] == "Diantar ke Alamat":
                    st.write(f"**Alamat:** {order['delivery_address']}")
                st.write(f"**Kondisi:** {order['shoe_condition'] or '-'}")
                st.write(f"**Pembayaran:** {order['payment_status']} · {order['payment_method']}")
            with payment:
                if order["payment_status"] == "Belum Bayar":
                    with st.form(f"settle_{order['id']}"):
                        method = st.selectbox(
                            "Metode pelunasan",
                            PAYMENT_METHODS,
                            key=f"settle_method_{order['id']}",
                        )
                        if st.form_submit_button("Lunasi Pembayaran", type="primary"):
                            settle_order(order["id"], method)
                            st.success("Pembayaran berhasil dilunasi.")
                            st.rerun()
                else:
                    st.success("Pembayaran lunas")

            workflow = DELIVERY_STATUSES if order["delivery_type"] == "Diantar ke Alamat" else PICKUP_STATUSES
            current_index = workflow.index(order["wash_status"])
            if current_index + 1 < len(workflow):
                next_status = workflow[current_index + 1]
                with st.form(f"status_{order['id']}"):
                    st.write(f"**Status saat ini:** {order['wash_status']}")
                    st.write(f"**Status berikutnya:** {next_status}")
                    proof_file = None
                    if (
                        order["delivery_type"] == "Diantar ke Alamat"
                        and next_status == "Selesai"
                    ):
                        proof_file = st.file_uploader(
                            "Foto bukti pengantaran (opsional)",
                            type=("jpg", "jpeg", "png", "webp"),
                            key=f"proof_{order['id']}",
                        )
                    if st.form_submit_button("Perbarui Status", type="primary"):
                        update_wash_status(order["id"], next_status, proof_file)
                        st.success(f"Status berhasil diperbarui menjadi {next_status}.")
                        st.rerun()
            else:
                st.success("Proses pesanan selesai.")

            if order["delivery_proof"]:
                st.image(
                    order["delivery_proof"],
                    caption=f"Bukti pengantaran · {order['delivery_proof_name'] or 'foto'}",
                    width=320,
                )


def owner_dashboard_page():
    st.title("Dashboard Ringkasan")
    totals = query_one(
        """
        SELECT
            COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END), 0)
                AS total_income,
            COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0)
                AS total_expense
        FROM cash_transactions
        """
    )
    finished = query_one("SELECT COUNT(*) AS count FROM orders WHERE wash_status = 'Selesai'")
    in_progress = query_one("SELECT COUNT(*) AS count FROM orders WHERE wash_status != 'Selesai'")
    columns = st.columns(3)
    columns[0].metric("Total Pendapatan", format_rupiah(totals["total_income"]))
    columns[1].metric("Jumlah Sepatu Selesai", finished["count"])
    columns[2].metric("Sepatu Masih Dikerjakan", in_progress["count"])
    st.caption(f"Pengeluaran tercatat: {format_rupiah(totals['total_expense'])}")


def owner_transactions_page():
    st.title("Laporan Transaksi Lengkap")
    rows = query_all(
        """
        SELECT
            orders.order_number AS 'Nomor Order',
            orders.created_at AS 'Tanggal Order',
            orders.customer_name AS 'Pelanggan',
            orders.customer_whatsapp AS 'WhatsApp',
            orders.shoe_brand AS 'Merek Sepatu',
            orders.shoe_size AS 'Ukuran',
            services.name AS 'Layanan',
            orders.estimated_cost AS 'Estimasi Biaya (Rp)',
            orders.payment_status AS 'Status Bayar',
            orders.payment_method AS 'Metode Bayar',
            orders.delivery_type AS 'Penyerahan',
            orders.wash_status AS 'Status Cuci'
        FROM orders
        JOIN services ON services.id = orders.service_id
        ORDER BY orders.created_at DESC
        """
    )
    if rows:
        st.dataframe(pd.DataFrame([dict(row) for row in rows]), hide_index=True, use_container_width=True)
    else:
        st.info("Belum ada transaksi.")


def owner_cashbook_page():
    st.title("Buku Kas")
    totals = query_one(
        """
        SELECT
            COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END), 0)
                AS cash_in,
            COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0)
                AS cash_out
        FROM cash_transactions
        """
    )
    first, second, third = st.columns(3)
    first.metric("Kas Masuk", format_rupiah(totals["cash_in"]))
    second.metric("Kas Keluar", format_rupiah(totals["cash_out"]))
    second_balance = totals["cash_in"] - totals["cash_out"]
    third.metric("Saldo Kas", format_rupiah(second_balance))

    with st.expander("Catat Pengeluaran"):
        with st.form("expense_form", clear_on_submit=True):
            description = st.text_input("Keterangan", placeholder="Contoh: beli sabun dan sikat")
            category_label = st.selectbox(
                "Kategori Pengeluaran",
                list(CATEGORIES.values()),
            )
            amount = st.number_input("Jumlah (Rp)", min_value=1, step=5000)
            payment_method = st.selectbox("Dibayar melalui", PAYMENT_METHODS)
            submitted = st.form_submit_button("Simpan Pengeluaran", type="primary")
        if submitted:
            if not description.strip():
                st.error("Keterangan pengeluaran wajib diisi.")
            else:
                category = next(key for key, value in CATEGORIES.items() if value == category_label)
                add_expense(description, category, int(amount), payment_method)
                st.success("Pengeluaran berhasil dicatat.")
                st.rerun()

    transactions = query_all(
        """
        SELECT id, transaction_type, amount, description, category,
               payment_method, transaction_date
        FROM cash_transactions
        ORDER BY transaction_date ASC, id ASC
        """
    )
    if not transactions:
        st.info("Belum ada transaksi kas.")
        return

    running_balance = 0
    entries = []
    for transaction in transactions:
        is_income = transaction["transaction_type"] == "income"
        amount = transaction["amount"]
        running_balance += amount if is_income else -amount
        description = transaction["description"]
        if not is_income and transaction["category"]:
            description = f"{CATEGORIES.get(transaction['category'], 'Pengeluaran')} · {description}"
        entries.append(
            {
                "Tanggal": datetime.fromisoformat(transaction["transaction_date"]).strftime("%d-%m-%Y %H:%M"),
                "Jenis": "Kas Masuk" if is_income else "Kas Keluar",
                "Keterangan": description,
                "Metode": transaction["payment_method"],
                "Kas Masuk": format_rupiah(amount) if is_income else "-",
                "Kas Keluar": "-" if is_income else format_rupiah(amount),
                "Saldo": format_rupiah(running_balance),
            }
        )
    st.dataframe(pd.DataFrame(entries[::-1]), hide_index=True, use_container_width=True)


def owner_services_page():
    st.title("Kelola Layanan & Harga")
    services = query_all(
        "SELECT id, name, price, is_active FROM services ORDER BY is_active DESC, name"
    )
    st.dataframe(
        pd.DataFrame(
            [
                {
                    "Layanan": service["name"],
                    "Harga": format_rupiah(service["price"]),
                    "Status": "Aktif" if service["is_active"] else "Nonaktif",
                }
                for service in services
            ]
        ),
        hide_index=True,
        use_container_width=True,
    )

    with st.expander("Tambah Layanan Baru"):
        with st.form("add_service_form", clear_on_submit=True):
            name = st.text_input("Nama Layanan")
            price = st.number_input("Harga (Rp)", min_value=1, step=5000)
            submitted = st.form_submit_button("Tambah Layanan", type="primary")
        if submitted:
            if not name.strip():
                st.error("Nama layanan wajib diisi.")
            else:
                try:
                    with db_connection() as connection:
                        connection.execute(
                            "INSERT INTO services (name, price, created_at) VALUES (?, ?, ?)",
                            (name.strip(), int(price), datetime.now().isoformat(timespec="seconds")),
                        )
                    st.success("Layanan baru berhasil ditambahkan.")
                    st.rerun()
                except sqlite3.IntegrityError:
                    st.error("Nama layanan tersebut sudah digunakan.")

    active_services = [service for service in services if service["is_active"]]
    if active_services:
        with st.expander("Ubah Harga Layanan"):
            service_options = {
                service["name"]: service for service in active_services
            }
            selected_name = st.selectbox("Pilih Layanan", list(service_options))
            selected_service = service_options[selected_name]
            with st.form("edit_service_price_form"):
                new_price = st.number_input(
                    "Harga Baru (Rp)",
                    min_value=1,
                    step=5000,
                    value=int(selected_service["price"]),
                )
                submitted = st.form_submit_button("Simpan Harga", type="primary")
            if submitted:
                with db_connection() as connection:
                    connection.execute(
                        "UPDATE services SET price = ? WHERE id = ?",
                        (int(new_price), selected_service["id"]),
                    )
                st.success("Harga layanan berhasil diperbarui.")
                st.rerun()


def main():
    initialize_database()
    st.session_state.setdefault("is_logged_in", False)
    st.session_state.setdefault("username", "")
    st.session_state.setdefault("role", "")

    if not st.session_state["is_logged_in"]:
        login_page()
        return

    role = st.session_state["role"]
    if role not in ("admin", "owner"):
        for key in ("is_logged_in", "username", "role"):
            st.session_state.pop(key, None)
        st.error("Peran akun tidak valid. Silakan login kembali.")
        st.rerun()

    selected_page = sidebar_menu(role)
    if role == "admin":
        if selected_page == "Input Order Masuk":
            order_input_page()
        else:
            order_status_page()
        return

    owner_pages = {
        "Dashboard Ringkasan": owner_dashboard_page,
        "Laporan Transaksi": owner_transactions_page,
        "Buku Kas": owner_cashbook_page,
        "Kelola Layanan & Harga": owner_services_page,
    }
    owner_pages[selected_page]()


if __name__ == "__main__":
    main()
