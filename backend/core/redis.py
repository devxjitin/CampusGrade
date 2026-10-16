from config import get_settings

redis_pool = None

async def init_redis():
    global redis_pool
    try:
        import redis.asyncio as aioredis
        redis_pool = aioredis.from_url(get_settings().redis_url, decode_responses=True)
        await redis_pool.ping()
    except Exception:
        redis_pool = None
    return redis_pool

async def close_redis():
    if redis_pool is not None:
        await redis_pool.aclose()

async def get_redis():
    return redis_pool
