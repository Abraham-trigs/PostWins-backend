// apps/backend/src/lib/redis.ts
// Purpose: Shared Redis pub/sub client

import Redis from "ioredis";

export const redisPub = new Redis(process.env.REDIS_URL!);
export const redisSub = new Redis(process.env.REDIS_URL!);

redisPub.on("error", console.error);
redisSub.on("error", console.error);
