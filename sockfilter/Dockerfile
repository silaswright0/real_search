FROM python:3.12-slim-bookworm@sha256:0f5b26b9518d002b6173fd61daad821fa340635ebfec5bba471013f9ca114579

RUN useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin sockfilter

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY main.py /app/main.py
RUN chown -R sockfilter:sockfilter /app

USER sockfilter
EXPOSE 2375
CMD ["python", "-u", "/app/main.py"]
