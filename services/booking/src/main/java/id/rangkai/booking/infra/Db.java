package id.rangkai.booking.infra;

import id.rangkai.booking.service.Tx;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;
import org.sqlite.SQLiteConfig;

/**
 * Akses SQLite: satu koneksi tulis (BEGIN IMMEDIATE) dan beberapa koneksi baca.
 * Antar instance, transaksi tulis diserialkan oleh kunci file SQLite dengan busy timeout, sehingga seat locking tetap atomik.
 * Semua query memakai prepared statement.
 */
public final class Db implements Tx, AutoCloseable {
    private static final int READERS = 4;
    private static final int MAX_BUSY_RETRY = 8;

    private final Connection writer;
    private final BlockingQueue<Connection> readers = new ArrayBlockingQueue<>(READERS);
    private final ReentrantLock writeLock = new ReentrantLock();
    private final ThreadLocal<Boolean> inTx = ThreadLocal.withInitial(() -> false);

    public Db(Path file) {
        try {
            Files.createDirectories(file.toAbsolutePath().getParent());
            String url = "jdbc:sqlite:" + file.toAbsolutePath();
            SQLiteConfig cfg = new SQLiteConfig();
            cfg.setJournalMode(SQLiteConfig.JournalMode.WAL);
            cfg.setSynchronous(SQLiteConfig.SynchronousMode.NORMAL);
            cfg.setBusyTimeout(15000);
            cfg.setTransactionMode(SQLiteConfig.TransactionMode.IMMEDIATE);
            writer = cfg.createConnection(url);
            for (int i = 0; i < READERS; i++) readers.add(cfg.createConnection(url));
        } catch (Exception e) {
            throw new IllegalStateException("Gagal membuka database: " + e.getMessage(), e);
        }
    }

    public void script(String sql) {
        writeLock.lock();
        try (var st = writer.createStatement()) {
            for (String part : sql.split(";")) if (!part.isBlank()) st.executeUpdate(part);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        } finally {
            writeLock.unlock();
        }
    }

    @Override
    public <T> T run(Supplier<T> work) {
        if (inTx.get()) return work.get();
        writeLock.lock();
        try {
            for (int attempt = 0; ; attempt++) {
                try {
                    writer.setAutoCommit(false);
                    inTx.set(true);
                    T result = work.get();
                    writer.commit();
                    return result;
                } catch (RuntimeException | SQLException e) {
                    rollbackQuietly();
                    if (isBusy(e) && attempt < MAX_BUSY_RETRY) {
                        inTx.set(false);
                        sleep(20L << attempt);
                        continue;
                    }
                    if (e instanceof RuntimeException re) throw re;
                    throw new IllegalStateException(e);
                } finally {
                    inTx.set(false);
                    autoCommitQuietly();
                }
            }
        } finally {
            writeLock.unlock();
        }
    }

    public int update(String sql, Object... args) {
        if (inTx.get()) return exec(writer, sql, args);
        return run(() -> exec(writer, sql, args));
    }

    public List<Map<String, Object>> list(String sql, Object... args) {
        if (inTx.get()) return query(writer, sql, args);
        Connection c = null;
        try {
            c = readers.take();
            return query(c, sql, args);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        } finally {
            if (c != null) readers.add(c);
        }
    }

    public Optional<Map<String, Object>> one(String sql, Object... args) {
        List<Map<String, Object>> rows = list(sql, args);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    private static int exec(Connection c, String sql, Object[] args) {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, args);
            return ps.executeUpdate();
        } catch (SQLException e) {
            throw new DbException(e);
        }
    }

    private static List<Map<String, Object>> query(Connection c, String sql, Object[] args) {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, args);
            try (ResultSet rs = ps.executeQuery()) {
                ResultSetMetaData md = rs.getMetaData();
                List<Map<String, Object>> out = new ArrayList<>();
                while (rs.next()) {
                    Map<String, Object> row = new HashMap<>();
                    for (int i = 1; i <= md.getColumnCount(); i++) row.put(md.getColumnLabel(i), rs.getObject(i));
                    out.add(row);
                }
                return out;
            }
        } catch (SQLException e) {
            throw new DbException(e);
        }
    }

    private static void bind(PreparedStatement ps, Object[] args) throws SQLException {
        for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
    }

    private static boolean isBusy(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            String m = t.getMessage();
            if (m != null && (m.contains("SQLITE_BUSY") || m.contains("database is locked"))) return true;
        }
        return false;
    }

    private void rollbackQuietly() {
        try { writer.rollback(); } catch (SQLException ignored) { /* transaksi memang sudah batal */ }
    }

    private void autoCommitQuietly() {
        try { writer.setAutoCommit(true); } catch (SQLException ignored) { /* koneksi tetap dipakai ulang */ }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    public static long num(Map<String, Object> row, String col) {
        Object v = row.get(col);
        return v == null ? 0L : ((Number) v).longValue();
    }

    public static String str(Map<String, Object> row, String col) {
        Object v = row.get(col);
        return v == null ? null : v.toString();
    }

    @Override
    public void close() {
        try { writer.close(); } catch (SQLException ignored) { /* penutupan saat proses berhenti */ }
        for (Connection c : readers) {
            try { c.close(); } catch (SQLException ignored) { /* penutupan saat proses berhenti */ }
        }
    }

    public static final class DbException extends RuntimeException {
        public DbException(Throwable cause) { super(cause.getMessage(), cause); }
    }
}
