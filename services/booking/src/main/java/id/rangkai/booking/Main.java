package id.rangkai.booking;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsParameters;
import com.sun.net.httpserver.HttpsServer;
import id.rangkai.booking.infra.Db;
import id.rangkai.booking.infra.Discovery;
import id.rangkai.booking.infra.FieldCrypto;
import id.rangkai.booking.infra.JwtVerifier;
import id.rangkai.booking.infra.Log;
import id.rangkai.booking.infra.Mtls;
import id.rangkai.booking.infra.OutboxEvents;
import id.rangkai.booking.infra.Schema;
import id.rangkai.booking.infra.SqliteSeatStore;
import id.rangkai.booking.infra.TripCatalog;
import id.rangkai.booking.infra.Workers;
import id.rangkai.booking.service.BookingService;
import id.rangkai.booking.service.SeatLockService;
import id.rangkai.booking.web.Api;
import id.rangkai.booking.web.HttpApp;
import id.rangkai.booking.web.SeatEventHub;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.concurrent.Executors;
import javax.net.ssl.SSLParameters;

/** Titik masuk booking-service. Dua instance berbagi satu file database, gateway membagi beban di antara keduanya. */
public final class Main {
    private Main() {}

    public static void main(String[] args) throws Exception {
        System.setProperty("sun.net.httpserver.idleInterval", "120");
        System.setProperty("sun.net.httpserver.maxIdleConnections", "512");
        Config cfg = Config.fromEnv(System.getenv());
        Mtls mtls = new Mtls(cfg.certDir(), "booking");

        Db db = new Db(cfg.dataDir().resolve("booking.db"));
        db.script(Schema.DDL);

        OutboxEvents events = new OutboxEvents(db);
        SqliteSeatStore store = new SqliteSeatStore(db);
        SeatLockService locks = new SeatLockService(store, db, events, System::currentTimeMillis, cfg.lockTtlSeconds());
        Discovery discovery = new Discovery(mtls, cfg);
        TripCatalog catalog = new TripCatalog(mtls, discovery);
        BookingService bookings = new BookingService(db, store, locks, events, catalog, new FieldCrypto(cfg.piiKey()));

        JwtVerifier jwt = new JwtVerifier(mtls, cfg.authUrl() + "/internal/jwks", "rangkai-auth", "rangkai-api");
        HttpApp app = new HttpApp(jwt, cfg.instanceId());
        new Api(db, locks, bookings, catalog, new SeatEventHub(db), cfg.instanceId()).register(app);

        HttpsServer server = HttpsServer.create(new InetSocketAddress(InetAddress.getByName(cfg.bindHost()), cfg.port()), 1024);
        server.setHttpsConfigurator(new HttpsConfigurator(mtls.context()) {
            @Override
            public void configure(HttpsParameters params) {
                SSLParameters ssl = getSSLContext().getDefaultSSLParameters();
                ssl.setNeedClientAuth(true);
                ssl.setProtocols(new String[] {"TLSv1.3", "TLSv1.2"});
                params.setSSLParameters(ssl);
            }
        });
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.createContext("/", app::dispatch);
        server.start();
        Log.info("booking-service aktif", "port", cfg.port(), "lockTtlSeconds", cfg.lockTtlSeconds());

        discovery.startHeartbeat();
        new Workers(db, mtls, cfg, bookings).start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> { server.stop(0); db.close(); }));
    }
}
