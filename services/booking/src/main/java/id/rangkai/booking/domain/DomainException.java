package id.rangkai.booking.domain;

/** Pelanggaran aturan bisnis yang dipetakan ke respons HTTP dengan kode mesin dan pesan manusia. */
public class DomainException extends RuntimeException {
    private final int status;
    private final String code;
    private final transient Object details;

    public DomainException(int status, String code, String message) {
        this(status, code, message, null);
    }

    public DomainException(int status, String code, String message, Object details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public int status() { return status; }
    public String code() { return code; }
    public Object details() { return details; }
}
