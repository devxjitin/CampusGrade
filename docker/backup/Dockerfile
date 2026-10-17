# Backup/restore tool. Built on the same Postgres major as the database so pg_dump
# and pg_restore always match the server.
FROM postgres:18-alpine
RUN apk add --no-cache python3 py3-boto3
COPY backup.py /app/backup.py
WORKDIR /app
USER root
ENTRYPOINT ["python3", "/app/backup.py"]
CMD ["schedule"]
