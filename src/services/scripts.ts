// All keys of a pair use one Redis Cluster hash slot. Redis TIME is authoritative.
export const PUT = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local existing = redis.call('GET', KEYS[2])
if existing then
  local d = cjson.decode(existing)
  if d.fingerprint ~= ARGV[1] then return {'conflict'} end
  return {'duplicate', tostring(math.max(0, math.ceil((d.expiresAt - now) / 1000)))}
end
local received = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local skew = tonumber(ARGV[5])
if received > now + skew or received <= now - ttl then return {'stale'} end
local current = redis.call('GET', KEYS[1])
if current and cjson.decode(current).receivedMs > received then return {'order'} end
if ARGV[6] == 'encrypted' and redis.call('EXISTS', KEYS[3]) == 1 then return {'nonce'} end
local expires = math.min(now + ttl, received + ttl)
local remaining = math.max(1, math.floor(expires - now))
local item = cjson.decode(ARGV[2])
item.receivedMs = received
item.expiresMs = expires
-- Date formatting is performed by the application from expiresMs.
redis.call('SET', KEYS[1], cjson.encode(item), 'PX', remaining)
redis.call('SET', KEYS[2], cjson.encode({fingerprint=ARGV[1], expiresAt=expires, consumed=false}), 'PX', ttl + 2 * skew)
if ARGV[6] == 'encrypted' then redis.call('SET', KEYS[3], '1', 'PX', ttl + 2 * skew) end
redis.call('PUBLISH', ARGV[7], 'changed')
return {'created', tostring(math.ceil(remaining / 1000))}
`;
export const CONSUME = `
local existing = redis.call('GET', KEYS[2])
if not existing then return 0 end
local d = cjson.decode(existing)
if d.consumed then return 1 end
local current = redis.call('GET', KEYS[1])
if not current or cjson.decode(current).id ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
d.consumed = true
redis.call('SET', KEYS[2], cjson.encode(d), 'KEEPTTL')
return 1
`;
export const LIMIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}
`;
