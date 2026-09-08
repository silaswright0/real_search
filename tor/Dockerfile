FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d

RUN apk add --no-cache tor python3 busybox-extras su-exec \
  && mkdir -p /var/lib/tor \
  && chown -R tor:tor /etc/tor /var/lib/tor

COPY torrc /etc/tor/torrc
COPY socks-gate.py /usr/local/bin/socks-gate.py
COPY healthcheck.py /usr/local/bin/tor-healthcheck.py
COPY entrypoint.sh /usr/local/bin/real-search-tor-entrypoint.sh

RUN chmod 0555 /usr/local/bin/socks-gate.py \
    /usr/local/bin/tor-healthcheck.py \
    /usr/local/bin/real-search-tor-entrypoint.sh \
  && chown tor:tor /etc/tor/torrc

EXPOSE 9050

ENTRYPOINT ["/usr/local/bin/real-search-tor-entrypoint.sh"]
