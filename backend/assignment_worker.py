from redis import Redis
from rq import Queue, Worker

from config import get_settings


if __name__ == "__main__":
    connection = Redis.from_url(get_settings().redis_url)
    Worker([Queue("assignment-analysis", connection=connection)], connection=connection).work(with_scheduler=True)
