# Satu image untuk semua service. render.yaml menjalankan semuanya dalam satu container,
# docker-compose.yml menjalankan tiap service di container sendiri (mTLS benar-benar lintas container).
FROM maven:3.9-eclipse-temurin-21 AS build-java
WORKDIR /src
COPY services/booking/pom.xml .
COPY services/booking/src ./src
RUN mvn -B -q package -DskipTests

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates >/dev/null \
  && mkdir -p /opt/java \
  && wget -qO- https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse | tar xz -C /opt/java --strip-components=1
ENV PATH=/opt/java/bin:$PATH
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY services ./services
COPY web ./web
COPY docs ./docs
COPY scripts ./scripts
COPY .env.example ./
COPY --from=build-java /src/target/booking-service.jar ./services/booking/target/booking-service.jar
ENV NODE_ENV=production GATEWAY_HOST=0.0.0.0 TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "scripts/start-all.js"]
