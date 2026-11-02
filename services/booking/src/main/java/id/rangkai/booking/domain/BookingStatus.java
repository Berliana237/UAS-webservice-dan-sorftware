package id.rangkai.booking.domain;

import java.util.Set;

/** Mesin status pesanan. Transisi di luar tabel ini ditolak. */
public enum BookingStatus {
    PENDING_PAYMENT, CONFIRMED, CHECKED_IN, CANCELLED, EXPIRED;

    private Set<BookingStatus> next() {
        return switch (this) {
            case PENDING_PAYMENT -> Set.of(CONFIRMED, CANCELLED, EXPIRED);
            case CONFIRMED -> Set.of(CHECKED_IN, CANCELLED);
            case CHECKED_IN, CANCELLED, EXPIRED -> Set.of();
        };
    }

    public boolean canMoveTo(BookingStatus target) {
        return next().contains(target);
    }

    public BookingStatus moveTo(BookingStatus target) {
        if (!canMoveTo(target)) {
            throw new DomainException(409, "INVALID_STATE_TRANSITION", "Pesanan berstatus " + this + " tidak bisa diubah menjadi " + target + ".");
        }
        return target;
    }

    public boolean isTerminal() {
        return next().isEmpty();
    }
}
