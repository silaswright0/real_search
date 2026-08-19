FROM alpine:3.21

RUN apk add --no-cache tor busybox-extras

COPY torrc /etc/tor/torrc

RUN mkdir -p /var/lib/tor \
  && chown -R tor:tor /etc/tor /var/lib/tor

USER tor
EXPOSE 9050

CMD ["tor", "-f", "/etc/tor/torrc"]
