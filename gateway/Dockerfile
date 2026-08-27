FROM docker.io/library/nginx:1.27-alpine

COPY entrypoint.sh /real-search-entrypoint.sh

RUN chmod 0555 /real-search-entrypoint.sh

ENTRYPOINT ["/real-search-entrypoint.sh"]
