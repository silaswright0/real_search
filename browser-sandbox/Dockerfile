FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    firefox-esr \
    iptables \
    novnc \
    procps \
    socat \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /nonexistent /etc/firefox/policies /etc/firefox-esr/policies \
    /usr/lib/firefox-esr/distribution /usr/lib/firefox-esr/defaults/pref \
    /opt/firefox-profile \
  && chmod 000 /nonexistent \
  && useradd --create-home --uid 1000 --shell /usr/sbin/nologin sandbox

COPY policies.json /usr/lib/firefox-esr/distribution/policies.json
COPY policies.json /etc/firefox-esr/policies/policies.json
COPY policies.json /etc/firefox/policies/policies.json
COPY autoconfig.js /usr/lib/firefox-esr/defaults/pref/autoconfig.js
COPY firefox.cfg /usr/lib/firefox-esr/firefox.cfg
COPY user.js /opt/firefox-profile/user.js
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
  && chown -R sandbox:sandbox /home/sandbox

WORKDIR /home/sandbox
EXPOSE 6080

ENTRYPOINT ["/entrypoint.sh"]
