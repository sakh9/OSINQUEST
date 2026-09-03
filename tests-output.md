# Rate Limit test
**k6 run -e BASE_URL=https://osinquest-production.up.railway.app loadtest\ratelimit-test.js**    

     execution: local
        script: loadtest\ratelimit-test.js
        output: -

     scenarios: (100.00%) 1 scenario, 1 max VUs, 10m30s max duration (incl. graceful stop):
              * default: 35 iterations shared among 1 VUs (maxDuration: 10m0s, gracefulStop: 30s)



  TOTAL RESULTS 

    checks_total.......: 35      1.335625/s
    checks_succeeded...: 100.00% 35 out of 35
    checks_failed......: 0.00%   0 out of 35

    ✓ status is 200 or 429

    HTTP
    http_req_duration..............: avg=79.47ms  min=42.03ms  med=61.85ms  max=245.82ms p(90)=128.08ms p(95)=166.46ms
      { expected_response:true }...: avg=83.6ms   min=42.03ms  med=67.27ms  max=245.82ms p(90)=142.04ms p(95)=172.42ms
    http_req_failed................: 14.28% 5 out of 35
    http_reqs......................: 35     1.335625/s

    EXECUTION
    iteration_duration.............: avg=744.73ms min=542.37ms med=590.18ms max=3.42s    p(90)=894.56ms p(95)=1.44s   
    iterations.....................: 35     1.335625/s
    vus............................: 1      min=0       max=1
    vus_max........................: 1      min=0       max=1
    NETWORK
    data_received..................: 31 kB  1.2 kB/s
    data_sent......................: 5.0 kB 191 B/s




running (00m26.2s), 0/1 VUs, 35 complete and 0 interrupted iterations
default ✓ [======================================] 1 VUs  00m26.2s/10m0s  35/35 shared iters


# Throughput test
*k6 run -e BASE_URL=https://osinquest-production.up.railway.app .\loadtest\throughput-test.js*

execution: local
script:    .\loadtest\throughput-test.js
output:    -

scenarios:
  100.00%  1 scenario, 20 max VUs, 1m20s max duration
  default: Up to 20 looping VUs for 50s over 3 stages
           (gracefulRampDown: 30s, gracefulStop: 30s)


THRESHOLDS

errors
  ✓ 'rate<0.05' rate=0.00%

http_req_duration
  ✓ 'p(95)<3000' p(95)=60.59ms


TOTAL RESULTS

checks_total................: 1140     22.449432/s
checks_succeeded............: 100.00%  1140 out of 1140
checks_failed...............: 0.00%    0 out of 1140

✓ status is 200
✓ response has expected shape


CUSTOM

errors........................: 0.00%   0 out of 570

lookup_duration...............: avg=45.1ms
                                min=22.8ms
                                med=41.18ms
                                max=578.44ms
                                p(90)=52.6ms
                                p(95)=60.59ms


HTTP

http_req_duration.............: avg=45.1ms
                                min=22.8ms
                                med=41.18ms
                                max=578.44ms
                                p(90)=52.6ms
                                p(95)=60.59ms

{ expected_response:true }....: avg=45.1ms
                                min=22.8ms
                                med=41.18ms
                                max=578.44ms
                                p(90)=52.6ms
                                p(95)=60.59ms

http_req_failed...............: 0.00%   0 out of 570
http_reqs.....................: 570      11.224716/s


EXECUTION

iteration_duration............: avg=1.05s
                                min=1.02s
                                med=1.04s
                                max=1.59s
                                p(90)=1.06s
                                p(95)=1.09s

iterations....................: 570      11.224716/s

vus...........................: 1        min=1    max=20
vus_max.......................: 20       min=20   max=20


NETWORK

data_received.................: 1.0 MB  20 kB/s
data_sent......................: 93 kB   1.8 kB/s


running (0m50.8s), 00/20 VUs, 570 complete and 0 interrupted iterations

default ✓ [======================================] 00/20 VUs  50s