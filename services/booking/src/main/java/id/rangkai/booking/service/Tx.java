package id.rangkai.booking.service;

import java.util.function.Supplier;

/** Batas transaksi, agar logika layanan bisa diuji tanpa database sungguhan. */
public interface Tx {
    <T> T run(Supplier<T> work);
}
