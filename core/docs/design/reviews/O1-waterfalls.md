# O1 请求瀑布附表

与 [O1 主报告](O1.md) 同一轮 full01；各组选取最接近中位数的实际样本，没有合成时间线。前后端互不重叠分段见主报告。下文包括全部宿主模块资源；原始其他样本不提交，但全轮哈希见主报告。

## 4. 各场景请求瀑布

每组选总耗时最接近该组中位数的真实样本；起止均相对该次交互开始，结束为body/JSON完成（未完成则标明）。cache为应用缓存事件和条件重验证；HTTP缓存被临时路由关闭，不把状态200称为缓存命中。其他9次的全量瀑布保留原始JSONL，其哈希在后文；这里不以代表样本掩盖上表P95。cold/refresh的JS/CSS/HTML资源走ResourceTiming，API用fetch探针，不重复列两次。

### 20/small/cold（full01-20-small-2-doc1-1，total 14049.80ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R090 | 73.90 | 182.10 | transfer 10597 |
| R026 | 74.80 | 240.00 | transfer 950 |
| R072 | 75.10 | 247.90 | transfer 11737 |
| R083 | 75.80 | 258.50 | transfer 1885 |
| R066 | 76.20 | 269.90 | transfer 12819 |
| R020 | 76.60 | 281.90 | transfer 3131 |
| R036 | 77.00 | 290.50 | transfer 7971 |
| R076 | 77.40 | 324.70 | transfer 6928 |
| R057 | 78.00 | 345.80 | transfer 1579 |
| R031 | 78.50 | 359.80 | transfer 3024 |
| R017 | 78.90 | 406.30 | transfer 6381 |
| R077 | 79.50 | 440.60 | transfer 5434 |
| R084 | 79.80 | 583.90 | transfer 9345 |
| R037 | 80.10 | 592.90 | transfer 8819 |
| R058 | 83.20 | 596.00 | transfer 7975 |
| R089 | 83.50 | 468.50 | transfer 3384 |
| R041 | 83.90 | 623.80 | transfer 976 |
| R042 | 84.10 | 611.00 | transfer 23772 |
| R078 | 84.40 | 637.00 | transfer 151694 |
| R094 | 84.60 | 209.50 | transfer 70019 |
| R059 | 797.60 | 853.30 | transfer 3069 |
| R021 | 797.90 | 865.80 | transfer 19068 |
| R014 | 798.10 | 866.70 | transfer 967 |
| R018 | 798.30 | 887.20 | transfer 1345 |
| R038 | 798.50 | 897.30 | transfer 3024 |
| R091 | 798.70 | 910.90 | transfer 4927 |
| R086 | 798.90 | 931.10 | transfer 21689 |
| R067 | 799.10 | 965.70 | transfer 1948 |
| R073 | 799.30 | 980.80 | transfer 66127 |
| R068 | 799.60 | 989.10 | transfer 2233 |
| R039 | 799.70 | 915.00 | transfer 4754 |
| R022 | 799.90 | 1004.80 | transfer 1585 |
| R032 | 800.00 | 1014.00 | transfer 3526 |
| R060 | 800.20 | 1023.20 | transfer 2958 |
| R061 | 800.50 | 1036.00 | transfer 2287 |
| R053 | 800.70 | 1045.70 | transfer 1766 |
| R033 | 800.90 | 1056.00 | transfer 4516 |
| R027 | 801.30 | 1066.80 | transfer 1261 |
| R043 | 801.90 | 1076.50 | transfer 1661 |
| R092 | 802.50 | 1086.50 | transfer 1802 |
| R044 | 803.10 | 1116.10 | transfer 5207 |
| R080 | 803.70 | 1135.70 | transfer 2434 |
| R081 | 804.60 | 1147.50 | transfer 2207 |
| R087 | 804.90 | 1164.20 | transfer 3074 |
| R082 | 805.20 | 1182.70 | transfer 9785 |
| R008 | 805.30 | 1207.40 | transfer 2174 |
| R012 | 805.50 | 1231.80 | transfer 1995 |
| R088 | 805.60 | 1265.60 | transfer 2717 |
| R045 | 805.80 | 1358.30 | transfer 4185 |
| R028 | 806.10 | 1381.30 | transfer 3487 |
| R029 | 806.50 | 1281.30 | transfer 4839 |
| R046 | 806.80 | 1307.10 | transfer 3002 |
| R062 | 806.90 | 1388.20 | transfer 3229 |
| R063 | 807.10 | 1395.40 | transfer 2887 |
| R023 | 807.20 | 1319.50 | transfer 1130 |
| R054 | 807.40 | 1335.20 | transfer 835 |
| R034 | 808.10 | 1405.20 | transfer 3689 |
| R047 | 808.60 | 1410.40 | transfer 5002 |
| R048 | 808.90 | 1417.40 | transfer 4224 |
| R074 | 809.20 | 1420.40 | transfer 7302 |
| R015 | 810.50 | 1422.60 | transfer 1710 |
| R016 | 810.90 | 1431.40 | transfer 2700 |
| R019 | 811.20 | 1440.10 | transfer 1631 |
| R070 | 879.70 | 1455.30 | transfer 1144 |
| R055 | 880.00 | 1463.30 | transfer 6850 |
| R056 | 880.20 | 1470.60 | transfer 8116 |
| R069 | 939.70 | 1475.50 | transfer 2706 |
| R009 | 940.00 | 1480.70 | transfer 4254 |
| R064 | 940.40 | 1488.20 | transfer 6756 |
| R049 | 991.50 | 1500.00 | transfer 11239 |
| R024 | 991.80 | 1508.60 | transfer 1994 |
| R025 | 992.00 | 1513.80 | transfer 1485 |
| R030 | 992.20 | 1523.10 | transfer 1332 |
| R075 | 992.60 | 1530.40 | transfer 9218 |
| R071 | 993.10 | 1539.50 | transfer 1076 |
| R065 | 1151.90 | 1545.10 | transfer 2716 |
| R035 | 1392.70 | 1549.70 | transfer 945 |
| R050 | 1399.50 | 1554.00 | transfer 1061 |
| R085 | 1479.10 | 1488.20 | transfer 17787 |
| R010 | 1535.50 | 1562.30 | transfer 7724 |
| R013 | 1621.20 | 1710.10 | transfer 4900 |
| R079 | 1669.40 | 2209.90 | 200 |
| R052 | 1671.40 | 2237.30 | 200 |
| R041 | 1724.30 | 2218.90 | transfer 976 |
| R040 | 2243.90 | 12120.40 | 200 |
| R093 | 2272.20 | 2275.60 | transfer0（不据此认定cache） |
| R004 | 12132.90 | 12411.80 | 200 |
| R003 | 12413.70 | 13683.50 | 200 |
| R011 | 13685.10 | 13722.50 | 200 |
| R001 | 13961.90 | 13980.00 | 200 / body pending |
| R005 | 14045.90 | pending | pending / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:miss, quizforge.single-choice:2.0.1:d1cfa2e046dd40b3aacd13e717314d38166ca933d131748edfc96ac84c050981:miss, quizforge.richtext:1.1.3:static:miss, bank:o1-a:q002:miss。

### 20/small/first-b（full01-20-small-2-doc1-2，total 4882.70ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R051 | 13.70 | 4517.00 | 200 |
| R006 | 4520.70 | 4728.10 | 200 |
| R001 | 4820.10 | 4833.80 | 200 / body pending |
| R007 | 4870.70 | pending | pending / body pending |

应用缓存事件（题目/页面/SDK，含键）：quizforge.richtext:1.1.3:static:hit, bank:o1-b:q001:miss, quizforge.single-choice:2.0.1:d1cfa2e046dd40b3aacd13e717314d38166ca933d131748edfc96ac84c050981:hit, quizforge.richtext:1.1.3:static:hit, bank:o1-b:q002:miss。

### 20/small/return-a（full01-20-small-0-doc1-3，total 831.00ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R040 | 29.40 | 276.50 | 200 |
| R004 | 30.60 | 558.50 | 200 / conditional |
| R001 | 765.60 | 788.80 | 200 / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:revalidate, quizforge.single-choice:2.0.1:267869fbe0f9786ddaafd6380118dfda18adc689de39d86f2763e54b778a476d:hit, quizforge.richtext:1.1.3:static:hit, bank:o1-a:q002:hit, quizforge.multiple-choice:2.0.1:c62bacc23f285961c5bed297c0b6b586e677f414956c5be3f830ae1b2fc69846:hit, quizforge.richtext:1.1.3:static:hit。

### 20/small/refresh（full01-20-small-7-doc2-1，total 1905.30ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R090 | 57.50 | 107.80 | transfer 10597 |
| R026 | 58.60 | 139.90 | transfer 950 |
| R072 | 58.90 | 141.10 | transfer 11737 |
| R083 | 59.40 | 150.00 | transfer 1885 |
| R066 | 59.60 | 156.20 | transfer 12819 |
| R020 | 59.90 | 217.50 | transfer 3131 |
| R036 | 60.30 | 237.70 | transfer 7971 |
| R076 | 60.60 | 185.10 | transfer 6928 |
| R057 | 61.00 | 196.50 | transfer 1579 |
| R031 | 61.40 | 204.50 | transfer 3024 |
| R017 | 61.60 | 288.30 | transfer 6381 |
| R077 | 61.90 | 311.80 | transfer 5434 |
| R084 | 62.00 | 323.20 | transfer 9345 |
| R037 | 62.20 | 365.10 | transfer 8819 |
| R058 | 62.30 | 372.50 | transfer 7975 |
| R089 | 62.70 | 273.00 | transfer 3384 |
| R041 | 63.10 | 400.90 | transfer 976 |
| R042 | 63.30 | 383.10 | transfer 23772 |
| R078 | 63.50 | 379.30 | transfer 151694 |
| R094 | 63.70 | 127.10 | transfer 70019 |
| R059 | 401.60 | 432.10 | transfer 3069 |
| R021 | 401.80 | 437.70 | transfer 19068 |
| R014 | 402.10 | 443.10 | transfer 967 |
| R018 | 402.20 | 446.40 | transfer 1345 |
| R038 | 402.40 | 451.60 | transfer 3024 |
| R091 | 402.40 | 457.70 | transfer 4927 |
| R086 | 402.70 | 462.40 | transfer 21689 |
| R067 | 402.80 | 469.40 | transfer 1948 |
| R073 | 402.90 | 486.00 | transfer 66127 |
| R068 | 403.40 | 489.40 | transfer 2233 |
| R039 | 403.60 | 470.70 | transfer 4754 |
| R022 | 403.80 | 492.90 | transfer 1585 |
| R032 | 403.90 | 499.60 | transfer 3526 |
| R060 | 404.10 | 503.20 | transfer 2958 |
| R061 | 404.20 | 507.10 | transfer 2287 |
| R053 | 404.40 | 512.90 | transfer 1766 |
| R033 | 404.50 | 516.10 | transfer 4516 |
| R027 | 404.60 | 520.80 | transfer 1261 |
| R043 | 404.70 | 524.60 | transfer 1661 |
| R092 | 405.20 | 533.30 | transfer 1802 |
| R044 | 405.40 | 537.40 | transfer 5207 |
| R080 | 405.50 | 545.20 | transfer 2434 |
| R081 | 405.60 | 552.30 | transfer 2207 |
| R087 | 405.60 | 558.40 | transfer 3074 |
| R082 | 405.70 | 562.90 | transfer 9785 |
| R008 | 405.80 | 570.10 | transfer 2174 |
| R012 | 405.90 | 575.90 | transfer 1995 |
| R088 | 406.00 | 583.00 | transfer 2717 |
| R045 | 406.10 | 590.00 | transfer 4185 |
| R028 | 406.20 | 598.40 | transfer 3487 |
| R029 | 406.30 | 605.70 | transfer 4839 |
| R046 | 406.30 | 615.30 | transfer 3002 |
| R062 | 406.40 | 620.40 | transfer 3229 |
| R063 | 406.50 | 628.80 | transfer 2887 |
| R023 | 406.50 | 634.70 | transfer 1130 |
| R054 | 406.60 | 641.60 | transfer 835 |
| R034 | 406.70 | 649.50 | transfer 3689 |
| R047 | 406.70 | 654.70 | transfer 5002 |
| R048 | 406.80 | 659.10 | transfer 4224 |
| R074 | 406.90 | 664.30 | transfer 7302 |
| R015 | 406.90 | 668.30 | transfer 1710 |
| R016 | 407.00 | 673.20 | transfer 2700 |
| R019 | 407.40 | 678.90 | transfer 1631 |
| R070 | 442.20 | 682.70 | transfer 1144 |
| R055 | 442.30 | 686.20 | transfer 6850 |
| R056 | 442.60 | 692.90 | transfer 8116 |
| R069 | 466.10 | 706.20 | transfer 2706 |
| R009 | 466.30 | 724.90 | transfer 4254 |
| R064 | 466.50 | 734.60 | transfer 6756 |
| R049 | 494.00 | 743.30 | transfer 11239 |
| R024 | 494.20 | 761.10 | transfer 1994 |
| R025 | 494.50 | 765.90 | transfer 1485 |
| R030 | 494.60 | 752.00 | transfer 1332 |
| R075 | 494.70 | 775.50 | transfer 9218 |
| R071 | 494.80 | 784.40 | transfer 1076 |
| R065 | 555.40 | 791.20 | transfer 2716 |
| R035 | 623.60 | 796.20 | transfer 945 |
| R050 | 632.60 | 801.10 | transfer 1061 |
| R085 | 710.40 | 721.90 | transfer 17787 |
| R010 | 779.10 | 809.30 | transfer 7724 |
| R013 | 827.40 | 865.60 | transfer 4900 |
| R079 | 845.70 | 1101.10 | 200 |
| R052 | 846.50 | 1105.10 | 200 |
| R041 | 879.00 | 1106.30 | transfer 976 |
| R040 | 1107.40 | 1248.00 | 200 |
| R093 | 1119.40 | 1121.60 | transfer0（不据此认定cache） |
| R004 | 1253.90 | 1450.40 | 200 |
| R003 | 1451.10 | 1496.10 | 200 |
| R011 | 1497.10 | 1537.80 | 200 |
| R001 | 1813.40 | 1834.60 | 200 / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:miss, quizforge.single-choice:2.0.1:75ff108d48e7bbda71b6c30d0a081079306f3437f2e0f1d5b3e892d7aeea2e4c:miss, quizforge.richtext:1.1.3:static:miss。

### 20/large/cold（full01-20-large-5-doc1-1，total 16852.00ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R090 | 63.30 | 188.90 | transfer 10597 |
| R026 | 64.00 | 218.70 | transfer 950 |
| R072 | 64.10 | 244.10 | transfer 11737 |
| R083 | 64.30 | 363.60 | transfer 1885 |
| R066 | 64.60 | 255.80 | transfer 12819 |
| R020 | 64.70 | 443.20 | transfer 3131 |
| R036 | 64.90 | 477.80 | transfer 7971 |
| R076 | 65.10 | 456.60 | transfer 6928 |
| R057 | 65.30 | 390.80 | transfer 1579 |
| R031 | 65.40 | 427.90 | transfer 3024 |
| R017 | 65.60 | 460.00 | transfer 6381 |
| R077 | 66.00 | 433.80 | transfer 5434 |
| R084 | 66.20 | 466.90 | transfer 9345 |
| R037 | 66.70 | 482.90 | transfer 8819 |
| R058 | 67.10 | 472.20 | transfer 7975 |
| R089 | 67.30 | 493.30 | transfer 3384 |
| R041 | 68.10 | 532.30 | transfer 976 |
| R042 | 68.80 | 512.80 | transfer 23772 |
| R078 | 69.10 | 513.40 | transfer 151694 |
| R094 | 69.50 | 221.80 | transfer 70019 |
| R059 | 704.10 | 766.10 | transfer 3069 |
| R021 | 704.50 | 833.60 | transfer 19068 |
| R014 | 704.80 | 864.60 | transfer 967 |
| R018 | 705.80 | 891.00 | transfer 1345 |
| R038 | 706.20 | 904.90 | transfer 3024 |
| R091 | 706.40 | 955.70 | transfer 4927 |
| R086 | 706.60 | 973.40 | transfer 21689 |
| R067 | 707.90 | 1153.40 | transfer 1948 |
| R073 | 708.20 | 1193.90 | transfer 66127 |
| R068 | 708.30 | 1199.30 | transfer 2233 |
| R039 | 710.80 | 808.90 | transfer 4754 |
| R022 | 711.00 | 1209.00 | transfer 1585 |
| R032 | 711.40 | 1236.90 | transfer 3526 |
| R060 | 711.70 | 1251.00 | transfer 2958 |
| R061 | 712.10 | 1257.40 | transfer 2287 |
| R053 | 712.50 | 1261.90 | transfer 1766 |
| R033 | 712.80 | 1266.90 | transfer 4516 |
| R027 | 713.10 | 1229.80 | transfer 1261 |
| R043 | 713.20 | 1271.90 | transfer 1661 |
| R092 | 716.80 | 1278.70 | transfer 1802 |
| R044 | 717.20 | 1283.90 | transfer 5207 |
| R080 | 717.50 | 1291.00 | transfer 2434 |
| R081 | 717.80 | 1300.10 | transfer 2207 |
| R087 | 718.10 | 1309.10 | transfer 3074 |
| R082 | 718.20 | 1313.30 | transfer 9785 |
| R008 | 718.40 | 1320.30 | transfer 2174 |
| R012 | 718.60 | 1330.40 | transfer 1995 |
| R088 | 718.90 | 1339.50 | transfer 2717 |
| R045 | 718.90 | 1348.10 | transfer 4185 |
| R028 | 719.70 | 1355.50 | transfer 3487 |
| R029 | 719.90 | 1364.70 | transfer 4839 |
| R046 | 720.80 | 1373.60 | transfer 3002 |
| R062 | 721.00 | 1379.40 | transfer 3229 |
| R063 | 721.50 | 1387.80 | transfer 2887 |
| R023 | 721.60 | 1393.10 | transfer 1130 |
| R054 | 721.90 | 1398.60 | transfer 835 |
| R034 | 722.60 | 1403.70 | transfer 3689 |
| R047 | 724.70 | 1410.50 | transfer 5002 |
| R048 | 724.90 | 1416.10 | transfer 4224 |
| R074 | 725.10 | 1426.00 | transfer 7302 |
| R015 | 725.30 | 1432.60 | transfer 1710 |
| R016 | 725.50 | 1437.30 | transfer 2700 |
| R019 | 725.60 | 1443.90 | transfer 1631 |
| R070 | 869.40 | 1454.50 | transfer 1144 |
| R055 | 869.60 | 1460.40 | transfer 6850 |
| R056 | 869.80 | 1468.40 | transfer 8116 |
| R069 | 992.00 | 1476.60 | transfer 2706 |
| R009 | 993.20 | 1492.60 | transfer 4254 |
| R064 | 994.50 | 1506.60 | transfer 6756 |
| R049 | 1228.50 | 1519.70 | transfer 11239 |
| R024 | 1228.70 | 1533.20 | transfer 1994 |
| R025 | 1228.90 | 1547.30 | transfer 1485 |
| R030 | 1229.10 | 1559.90 | transfer 1332 |
| R075 | 1229.20 | 1570.70 | transfer 9218 |
| R071 | 1229.30 | 1583.50 | transfer 1076 |
| R065 | 1303.80 | 1590.60 | transfer 2716 |
| R035 | 1383.50 | 1598.60 | transfer 945 |
| R050 | 1392.30 | 1609.40 | transfer 1061 |
| R085 | 1483.40 | 1495.90 | transfer 17787 |
| R010 | 1576.50 | 1622.60 | transfer 7724 |
| R013 | 1704.80 | 3118.90 | transfer 4900 |
| R079 | 1783.20 | 3631.60 | 200 |
| R052 | 1786.30 | 3663.70 | 200 |
| R041 | 3134.60 | 3641.30 | transfer 976 |
| R093 | 3663.60 | 3667.90 | transfer0（不据此认定cache） |
| R040 | 3668.60 | 14834.60 | 200 |
| R004 | 14847.60 | 15116.90 | 200 |
| R003 | 15120.50 | 16293.50 | 200 |
| R011 | 16295.10 | 16333.00 | 200 |
| R001 | 16747.80 | 16768.60 | 200 / body pending |
| R005 | 16846.60 | pending | pending / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:miss, quizforge.single-choice:2.0.1:70d5b302e1a9cce7cec4df33931b037869627670483e4212d8779c7e8ce25aa0:miss, quizforge.richtext:1.1.3:static:miss, bank:o1-a:q002:miss。

### 20/large/first-b（full01-20-large-2-doc1-2，total 6626.10ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R002 | -18.00 | 1410.20 | 200 |
| R051 | 18.80 | 6130.70 | 200 |
| R006 | 6135.30 | 6413.40 | 200 |
| R001 | 6546.20 | 6573.90 | 200 / body pending |
| R007 | 6623.80 | pending | pending / body pending |

应用缓存事件（题目/页面/SDK，含键）：quizforge.richtext:1.1.3:static:hit, bank:o1-b:q001:miss, quizforge.single-choice:2.0.1:6255b0009e7eb07dd7e0446536aff97b73a1f466dfe166c64ecfb82a7db45b9f:hit, quizforge.richtext:1.1.3:static:hit, bank:o1-b:q002:miss。

### 20/large/return-a（full01-20-large-2-doc1-3，total 864.30ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R040 | 32.80 | 267.30 | 200 |
| R004 | 34.80 | 597.60 | 200 / conditional |
| R001 | 806.40 | 824.60 | 200 / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:revalidate, quizforge.single-choice:2.0.1:6255b0009e7eb07dd7e0446536aff97b73a1f466dfe166c64ecfb82a7db45b9f:hit, quizforge.richtext:1.1.3:static:hit, bank:o1-a:q002:hit, quizforge.multiple-choice:2.0.1:a18e97301d296b2469d39bf37d51f826542ea3dd70759ba4473772fc56250448:hit, quizforge.richtext:1.1.3:static:hit。

### 20/large/refresh（full01-20-large-3-doc2-1，total 2464.40ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R090 | 66.80 | 142.90 | transfer 10597 |
| R026 | 67.80 | 202.50 | transfer 950 |
| R072 | 68.00 | 206.50 | transfer 11737 |
| R083 | 68.10 | 217.10 | transfer 1885 |
| R066 | 68.30 | 248.10 | transfer 12819 |
| R020 | 68.40 | 263.30 | transfer 3131 |
| R036 | 68.60 | 273.60 | transfer 7971 |
| R076 | 68.90 | 229.10 | transfer 6928 |
| R057 | 69.10 | 235.20 | transfer 1579 |
| R031 | 69.40 | 283.70 | transfer 3024 |
| R017 | 69.60 | 291.70 | transfer 6381 |
| R077 | 69.90 | 298.30 | transfer 5434 |
| R084 | 70.20 | 312.80 | transfer 9345 |
| R037 | 70.50 | 320.00 | transfer 8819 |
| R058 | 70.80 | 329.50 | transfer 7975 |
| R089 | 71.10 | 349.70 | transfer 3384 |
| R041 | 71.50 | 552.60 | transfer 976 |
| R042 | 71.70 | 363.60 | transfer 23772 |
| R078 | 72.00 | 447.90 | transfer 151694 |
| R094 | 72.20 | 171.40 | transfer 70019 |
| R059 | 475.10 | 560.50 | transfer 3069 |
| R021 | 475.40 | 569.20 | transfer 19068 |
| R014 | 475.60 | 580.10 | transfer 967 |
| R018 | 475.80 | 590.10 | transfer 1345 |
| R038 | 477.10 | 594.50 | transfer 3024 |
| R091 | 477.40 | 606.90 | transfer 4927 |
| R086 | 477.80 | 604.60 | transfer 21689 |
| R067 | 478.00 | 612.40 | transfer 1948 |
| R073 | 478.10 | 622.10 | transfer 66127 |
| R068 | 478.20 | 627.30 | transfer 2233 |
| R039 | 478.40 | 586.30 | transfer 4754 |
| R022 | 478.70 | 631.50 | transfer 1585 |
| R032 | 478.90 | 644.60 | transfer 3526 |
| R060 | 479.10 | 650.80 | transfer 2958 |
| R061 | 479.20 | 656.50 | transfer 2287 |
| R053 | 479.30 | 661.60 | transfer 1766 |
| R033 | 479.50 | 666.20 | transfer 4516 |
| R027 | 479.80 | 672.50 | transfer 1261 |
| R043 | 480.00 | 676.00 | transfer 1661 |
| R092 | 480.00 | 681.70 | transfer 1802 |
| R044 | 480.20 | 688.30 | transfer 5207 |
| R080 | 480.60 | 695.30 | transfer 2434 |
| R081 | 481.10 | 702.10 | transfer 2207 |
| R087 | 481.20 | 708.80 | transfer 3074 |
| R082 | 481.40 | 714.50 | transfer 9785 |
| R008 | 481.60 | 721.20 | transfer 2174 |
| R012 | 481.70 | 730.30 | transfer 1995 |
| R088 | 481.90 | 738.40 | transfer 2717 |
| R045 | 482.30 | 747.80 | transfer 4185 |
| R028 | 482.50 | 754.50 | transfer 3487 |
| R029 | 482.70 | 763.70 | transfer 4839 |
| R046 | 482.90 | 772.80 | transfer 3002 |
| R062 | 483.70 | 779.90 | transfer 3229 |
| R063 | 484.00 | 789.30 | transfer 2887 |
| R023 | 484.10 | 798.70 | transfer 1130 |
| R054 | 484.20 | 807.50 | transfer 835 |
| R034 | 484.30 | 812.80 | transfer 3689 |
| R047 | 485.30 | 822.80 | transfer 5002 |
| R048 | 485.60 | 832.20 | transfer 4224 |
| R074 | 485.80 | 837.00 | transfer 7302 |
| R015 | 486.00 | 840.70 | transfer 1710 |
| R016 | 486.10 | 864.80 | transfer 2700 |
| R019 | 486.10 | 909.30 | transfer 1631 |
| R070 | 574.70 | 941.50 | transfer 1144 |
| R055 | 575.00 | 960.30 | transfer 6850 |
| R056 | 575.30 | 969.20 | transfer 8116 |
| R069 | 614.70 | 893.00 | transfer 2706 |
| R009 | 614.90 | 975.30 | transfer 4254 |
| R064 | 615.00 | 991.10 | transfer 6756 |
| R049 | 628.90 | 984.80 | transfer 11239 |
| R024 | 629.10 | 997.40 | transfer 1994 |
| R025 | 629.20 | 1001.20 | transfer 1485 |
| R030 | 629.40 | 1007.40 | transfer 1332 |
| R075 | 629.60 | 1015.10 | transfer 9218 |
| R071 | 629.70 | 1021.10 | transfer 1076 |
| R065 | 705.50 | 1024.80 | transfer 2716 |
| R035 | 783.90 | 1029.00 | transfer 945 |
| R050 | 793.70 | 1032.40 | transfer 1061 |
| R085 | 897.60 | 927.70 | transfer 17787 |
| R010 | 1018.30 | 1039.00 | transfer 7724 |
| R013 | 1056.10 | 1088.10 | transfer 4900 |
| R079 | 1069.00 | 1348.90 | 200 |
| R052 | 1069.70 | 1357.40 | 200 |
| R041 | 1104.80 | 1358.00 | transfer 976 |
| R040 | 1360.20 | 1608.20 | 200 |
| R093 | 1370.80 | 1376.80 | transfer0（不据此认定cache） |
| R004 | 1615.20 | 1960.60 | 200 |
| R003 | 1962.90 | 2016.70 | 200 |
| R011 | 2017.80 | 2047.30 | 200 |
| R001 | 2395.10 | 2412.50 | 200 / body pending |
| R005 | 2447.80 | pending | pending / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:miss, quizforge.single-choice:2.0.1:a30ec5939a5001084184679b29455e28589f24562d0a90a592e2fe5f0b79de5e:miss, quizforge.richtext:1.1.3:static:miss, bank:o1-a:q002:miss。

### 200/small/cold（full01-200-small-1-doc1-1，total 13644.20ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R090 | 131.00 | 301.60 | transfer 10597 |
| R026 | 132.70 | 352.80 | transfer 950 |
| R072 | 133.00 | 362.00 | transfer 11737 |
| R083 | 133.20 | 376.00 | transfer 1885 |
| R066 | 133.30 | 381.00 | transfer 12819 |
| R020 | 133.50 | 384.70 | transfer 3131 |
| R036 | 133.70 | 341.70 | transfer 7971 |
| R076 | 134.50 | 393.80 | transfer 6928 |
| R057 | 135.10 | 400.50 | transfer 1579 |
| R031 | 135.30 | 408.30 | transfer 3024 |
| R017 | 135.60 | 414.80 | transfer 6381 |
| R077 | 136.10 | 420.30 | transfer 5434 |
| R084 | 136.30 | 423.60 | transfer 9345 |
| R037 | 136.70 | 427.10 | transfer 8819 |
| R058 | 137.00 | 431.60 | transfer 7975 |
| R089 | 137.20 | 438.00 | transfer 3384 |
| R041 | 137.40 | 457.40 | transfer 976 |
| R042 | 137.80 | 455.20 | transfer 23772 |
| R078 | 138.20 | 452.50 | transfer 151694 |
| R094 | 139.00 | 255.80 | transfer 70019 |
| R059 | 644.50 | 1378.80 | transfer 3069 |
| R021 | 644.70 | 1382.50 | transfer 19068 |
| R014 | 645.00 | 1385.60 | transfer 967 |
| R018 | 645.20 | 1389.30 | transfer 1345 |
| R038 | 645.90 | 1394.50 | transfer 3024 |
| R091 | 646.30 | 1399.00 | transfer 4927 |
| R086 | 646.60 | 1404.30 | transfer 21689 |
| R067 | 646.90 | 1412.40 | transfer 1948 |
| R073 | 647.20 | 1420.50 | transfer 66127 |
| R068 | 647.40 | 1423.90 | transfer 2233 |
| R039 | 647.60 | 720.40 | transfer 4754 |
| R022 | 647.80 | 1429.00 | transfer 1585 |
| R032 | 648.00 | 1432.90 | transfer 3526 |
| R060 | 648.20 | 1438.20 | transfer 2958 |
| R061 | 648.40 | 1444.90 | transfer 2287 |
| R053 | 648.60 | 1448.70 | transfer 1766 |
| R033 | 648.80 | 1453.10 | transfer 4516 |
| R027 | 648.90 | 1457.10 | transfer 1261 |
| R043 | 649.00 | 1461.50 | transfer 1661 |
| R092 | 649.20 | 1468.40 | transfer 1802 |
| R044 | 649.20 | 1472.50 | transfer 5207 |
| R080 | 649.40 | 1479.40 | transfer 2434 |
| R081 | 649.40 | 1488.30 | transfer 2207 |
| R087 | 650.10 | 1494.30 | transfer 3074 |
| R082 | 650.30 | 1499.40 | transfer 9785 |
| R008 | 650.40 | 1504.90 | transfer 2174 |
| R012 | 650.60 | 1515.10 | transfer 1995 |
| R088 | 650.80 | 1525.80 | transfer 2717 |
| R045 | 650.90 | 1532.80 | transfer 4185 |
| R028 | 651.00 | 1537.00 | transfer 3487 |
| R029 | 651.20 | 1543.80 | transfer 4839 |
| R046 | 651.40 | 1550.50 | transfer 3002 |
| R062 | 651.60 | 1558.20 | transfer 3229 |
| R063 | 651.70 | 1563.00 | transfer 2887 |
| R023 | 651.80 | 1571.30 | transfer 1130 |
| R054 | 652.00 | 1577.70 | transfer 835 |
| R034 | 652.00 | 1584.70 | transfer 3689 |
| R047 | 652.30 | 1589.50 | transfer 5002 |
| R048 | 652.40 | 1595.60 | transfer 4224 |
| R074 | 652.50 | 1601.10 | transfer 7302 |
| R015 | 652.60 | 1607.00 | transfer 1710 |
| R016 | 652.70 | 1614.70 | transfer 2700 |
| R019 | 654.60 | 1620.90 | transfer 1631 |
| R070 | 1386.20 | 1629.10 | transfer 1144 |
| R055 | 1386.40 | 1637.70 | transfer 6850 |
| R056 | 1386.50 | 1647.90 | transfer 8116 |
| R069 | 1408.00 | 1658.60 | transfer 2706 |
| R009 | 1408.20 | 1668.10 | transfer 4254 |
| R064 | 1408.50 | 1679.70 | transfer 6756 |
| R049 | 1427.20 | 1689.90 | transfer 11239 |
| R024 | 1427.30 | 1699.80 | transfer 1994 |
| R025 | 1427.40 | 1708.10 | transfer 1485 |
| R030 | 1427.80 | 1716.00 | transfer 1332 |
| R075 | 1427.90 | 1723.80 | transfer 9218 |
| R071 | 1428.10 | 1731.60 | transfer 1076 |
| R065 | 1491.60 | 1738.80 | transfer 2716 |
| R035 | 1562.00 | 1747.10 | transfer 945 |
| R050 | 1567.70 | 1755.50 | transfer 1061 |
| R085 | 1662.40 | 1669.60 | transfer 17787 |
| R010 | 1727.80 | 1763.30 | transfer 7724 |
| R013 | 1840.90 | 1974.30 | transfer 4900 |
| R079 | 1913.60 | 2520.30 | 200 |
| R052 | 1916.60 | 2525.30 | 200 |
| R041 | 1987.00 | 2528.50 | transfer 976 |
| R040 | 2533.80 | 11978.10 | 200 |
| R093 | 2581.60 | 2585.30 | transfer0（不据此认定cache） |
| R004 | 11989.80 | 12196.40 | 200 |
| R003 | 12197.80 | 13279.60 | 200 |
| R011 | 13281.10 | 13328.00 | 200 |
| R001 | 13524.90 | 13543.20 | 200 / body pending |
| R005 | 13639.00 | pending | pending / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:miss, quizforge.single-choice:2.0.1:8f098ed33e87b961b4a07ff333cae03b74a6dea3898fdc668335d4892ae0cbc0:miss, quizforge.richtext:1.1.3:static:miss, bank:o1-a:q002:miss。

### 200/small/first-b（full01-200-small-0-doc1-2，total 5354.10ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R002 | 21.20 | 1204.60 | 200 |
| R051 | 23.20 | 4680.40 | 200 |
| R006 | 4686.60 | 5126.30 | 200 |
| R001 | 5261.90 | 5279.40 | 200 / body pending |

应用缓存事件（题目/页面/SDK，含键）：quizforge.multiple-choice:2.0.1:9c83f427db94dc67f0ff41568778d21c98aa20745b6f6a4ead0d5cbb128d1025:miss, quizforge.richtext:1.1.3:static:hit, bank:o1-b:q001:miss, quizforge.single-choice:2.0.1:4af2403ce3d22d1e58d323791f346c66a1e4bb44518d3906040c5e1f38cfce59:hit, quizforge.richtext:1.1.3:static:hit。

### 200/small/return-a（full01-200-small-0-doc1-3，total 726.80ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R040 | 97.30 | 444.30 | 200 |
| R004 | 100.30 | 445.90 | 200 / conditional |
| R001 | 660.80 | 680.40 | 200 / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:revalidate, quizforge.single-choice:2.0.1:4af2403ce3d22d1e58d323791f346c66a1e4bb44518d3906040c5e1f38cfce59:hit, quizforge.richtext:1.1.3:static:hit。

### 200/small/refresh（full01-200-small-1-doc2-1，total 2258.00ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R090 | 59.60 | 102.00 | transfer 10597 |
| R026 | 60.10 | 124.80 | transfer 950 |
| R072 | 60.30 | 127.80 | transfer 11737 |
| R083 | 60.30 | 132.20 | transfer 1885 |
| R066 | 60.50 | 136.60 | transfer 12819 |
| R020 | 60.80 | 161.00 | transfer 3131 |
| R036 | 60.90 | 165.10 | transfer 7971 |
| R076 | 61.50 | 144.00 | transfer 6928 |
| R057 | 61.70 | 148.50 | transfer 1579 |
| R031 | 61.90 | 155.80 | transfer 3024 |
| R017 | 62.00 | 170.00 | transfer 6381 |
| R077 | 62.10 | 174.80 | transfer 5434 |
| R084 | 62.20 | 179.80 | transfer 9345 |
| R037 | 62.50 | 186.20 | transfer 8819 |
| R058 | 62.60 | 192.80 | transfer 7975 |
| R089 | 62.80 | 201.10 | transfer 3384 |
| R041 | 62.90 | 219.50 | transfer 976 |
| R042 | 63.10 | 205.80 | transfer 23772 |
| R078 | 63.30 | 212.20 | transfer 151694 |
| R094 | 63.50 | 116.80 | transfer 70019 |
| R059 | 230.90 | 261.60 | transfer 3069 |
| R021 | 231.10 | 266.30 | transfer 19068 |
| R014 | 231.30 | 285.90 | transfer 967 |
| R018 | 231.40 | 297.90 | transfer 1345 |
| R038 | 231.50 | 301.80 | transfer 3024 |
| R091 | 231.60 | 311.20 | transfer 4927 |
| R086 | 231.70 | 323.90 | transfer 21689 |
| R067 | 231.90 | 337.40 | transfer 1948 |
| R073 | 232.00 | 359.10 | transfer 66127 |
| R068 | 232.10 | 359.40 | transfer 2233 |
| R039 | 232.70 | 313.90 | transfer 4754 |
| R022 | 232.90 | 373.50 | transfer 1585 |
| R032 | 233.10 | 382.90 | transfer 3526 |
| R060 | 233.20 | 389.10 | transfer 2958 |
| R061 | 233.40 | 399.50 | transfer 2287 |
| R053 | 233.50 | 412.00 | transfer 1766 |
| R033 | 233.70 | 417.60 | transfer 4516 |
| R027 | 233.90 | 425.20 | transfer 1261 |
| R043 | 234.00 | 434.00 | transfer 1661 |
| R092 | 234.20 | 446.10 | transfer 1802 |
| R044 | 234.40 | 454.30 | transfer 5207 |
| R080 | 234.60 | 465.60 | transfer 2434 |
| R081 | 234.70 | 487.00 | transfer 2207 |
| R087 | 234.90 | 506.10 | transfer 3074 |
| R082 | 235.30 | 517.50 | transfer 9785 |
| R008 | 235.60 | 533.60 | transfer 2174 |
| R012 | 235.80 | 548.60 | transfer 1995 |
| R088 | 236.20 | 564.40 | transfer 2717 |
| R045 | 236.40 | 602.10 | transfer 4185 |
| R028 | 236.50 | 633.30 | transfer 3487 |
| R029 | 236.60 | 684.70 | transfer 4839 |
| R046 | 237.10 | 699.60 | transfer 3002 |
| R062 | 237.50 | 702.00 | transfer 3229 |
| R063 | 237.90 | 720.80 | transfer 2887 |
| R023 | 238.20 | 714.50 | transfer 1130 |
| R054 | 238.60 | 729.30 | transfer 835 |
| R034 | 238.80 | 717.60 | transfer 3689 |
| R047 | 238.90 | 737.00 | transfer 5002 |
| R048 | 239.00 | 742.60 | transfer 4224 |
| R074 | 239.20 | 745.30 | transfer 7302 |
| R015 | 239.50 | 748.00 | transfer 1710 |
| R016 | 239.80 | 756.70 | transfer 2700 |
| R019 | 239.90 | 765.50 | transfer 1631 |
| R070 | 270.60 | 769.10 | transfer 1144 |
| R055 | 270.80 | 771.60 | transfer 6850 |
| R056 | 271.10 | 781.30 | transfer 8116 |
| R069 | 332.00 | 790.40 | transfer 2706 |
| R009 | 332.40 | 801.30 | transfer 4254 |
| R064 | 332.60 | 812.60 | transfer 6756 |
| R049 | 368.60 | 818.80 | transfer 11239 |
| R024 | 369.00 | 827.40 | transfer 1994 |
| R025 | 369.40 | 837.30 | transfer 1485 |
| R030 | 369.60 | 845.40 | transfer 1332 |
| R075 | 370.00 | 850.30 | transfer 9218 |
| R071 | 370.20 | 857.20 | transfer 1076 |
| R065 | 491.60 | 866.10 | transfer 2716 |
| R035 | 705.30 | 873.30 | transfer 945 |
| R050 | 725.40 | 862.00 | transfer 1061 |
| R085 | 794.30 | 802.50 | transfer 17787 |
| R010 | 854.40 | 878.90 | transfer 7724 |
| R013 | 897.00 | 931.80 | transfer 4900 |
| R079 | 912.30 | 1139.80 | 200 |
| R052 | 913.00 | 1147.00 | 200 |
| R041 | 942.90 | 1145.60 | transfer 976 |
| R040 | 1148.80 | 1329.50 | 200 |
| R093 | 1157.10 | 1161.50 | transfer0（不据此认定cache） |
| R004 | 1335.90 | 1835.60 | 200 |
| R003 | 1837.50 | 1919.80 | 200 |
| R011 | 1921.20 | 1976.40 | 200 |
| R001 | 2173.40 | 2186.30 | 200 / body pending |
| R005 | 2256.60 | pending | pending / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:miss, quizforge.single-choice:2.0.1:8f098ed33e87b961b4a07ff333cae03b74a6dea3898fdc668335d4892ae0cbc0:miss, quizforge.richtext:1.1.3:static:miss, bank:o1-a:q002:miss。

### 200/large/cold（full01-200-large-0-doc1-1，total 15220.90ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R090 | 67.20 | 156.80 | transfer 10597 |
| R026 | 68.10 | 247.00 | transfer 950 |
| R072 | 68.30 | 387.30 | transfer 11737 |
| R083 | 68.60 | 346.50 | transfer 1885 |
| R066 | 68.70 | 394.50 | transfer 12819 |
| R020 | 68.80 | 401.80 | transfer 3131 |
| R036 | 68.90 | 442.70 | transfer 7971 |
| R076 | 69.10 | 415.90 | transfer 6928 |
| R057 | 69.20 | 406.90 | transfer 1579 |
| R031 | 69.20 | 426.20 | transfer 3024 |
| R017 | 69.40 | 431.60 | transfer 6381 |
| R077 | 70.00 | 436.80 | transfer 5434 |
| R084 | 71.30 | 447.60 | transfer 9345 |
| R037 | 71.60 | 450.80 | transfer 8819 |
| R058 | 72.30 | 456.50 | transfer 7975 |
| R089 | 73.00 | 463.70 | transfer 3384 |
| R041 | 73.40 | 480.70 | transfer 976 |
| R042 | 73.70 | 474.70 | transfer 23772 |
| R078 | 74.20 | 479.50 | transfer 151694 |
| R094 | 74.40 | 169.60 | transfer 70019 |
| R059 | 670.30 | 727.50 | transfer 3069 |
| R021 | 670.50 | 756.90 | transfer 19068 |
| R014 | 670.80 | 764.90 | transfer 967 |
| R018 | 671.10 | 774.70 | transfer 1345 |
| R038 | 671.30 | 777.50 | transfer 3024 |
| R091 | 671.90 | 782.50 | transfer 4927 |
| R086 | 672.40 | 792.40 | transfer 21689 |
| R067 | 672.80 | 804.20 | transfer 1948 |
| R073 | 673.00 | 815.20 | transfer 66127 |
| R068 | 673.50 | 826.60 | transfer 2233 |
| R039 | 674.20 | 739.00 | transfer 4754 |
| R022 | 675.30 | 833.40 | transfer 1585 |
| R032 | 676.00 | 841.10 | transfer 3526 |
| R060 | 676.40 | 855.60 | transfer 2958 |
| R061 | 676.70 | 868.20 | transfer 2287 |
| R053 | 676.90 | 907.80 | transfer 1766 |
| R033 | 677.10 | 939.70 | transfer 4516 |
| R027 | 677.30 | 949.60 | transfer 1261 |
| R043 | 677.40 | 1049.80 | transfer 1661 |
| R092 | 677.60 | 1081.40 | transfer 1802 |
| R044 | 677.70 | 1100.50 | transfer 5207 |
| R080 | 677.90 | 994.00 | transfer 2434 |
| R081 | 678.10 | 1128.10 | transfer 2207 |
| R087 | 678.30 | 1034.80 | transfer 3074 |
| R082 | 678.40 | 1155.70 | transfer 9785 |
| R008 | 678.90 | 1214.30 | transfer 2174 |
| R012 | 679.20 | 1190.10 | transfer 1995 |
| R088 | 679.40 | 1225.50 | transfer 2717 |
| R045 | 679.70 | 1200.10 | transfer 4185 |
| R028 | 680.00 | 1234.40 | transfer 3487 |
| R029 | 680.30 | 1208.70 | transfer 4839 |
| R046 | 680.40 | 1239.70 | transfer 3002 |
| R062 | 680.60 | 1244.80 | transfer 3229 |
| R063 | 680.80 | 1247.20 | transfer 2887 |
| R023 | 680.90 | 1260.80 | transfer 1130 |
| R054 | 681.10 | 1267.50 | transfer 835 |
| R034 | 681.10 | 1272.90 | transfer 3689 |
| R047 | 681.30 | 1278.50 | transfer 5002 |
| R048 | 681.50 | 1283.80 | transfer 4224 |
| R074 | 681.50 | 1290.30 | transfer 7302 |
| R015 | 681.80 | 1296.20 | transfer 1710 |
| R016 | 682.60 | 1301.70 | transfer 2700 |
| R019 | 682.70 | 1307.00 | transfer 1631 |
| R070 | 767.20 | 1311.10 | transfer 1144 |
| R055 | 767.30 | 1316.10 | transfer 6850 |
| R056 | 767.60 | 1324.30 | transfer 8116 |
| R069 | 800.30 | 1331.40 | transfer 2706 |
| R009 | 800.50 | 1339.40 | transfer 4254 |
| R064 | 800.70 | 1346.90 | transfer 6756 |
| R049 | 826.50 | 1354.90 | transfer 11239 |
| R024 | 826.70 | 1363.10 | transfer 1994 |
| R025 | 827.00 | 1368.20 | transfer 1485 |
| R030 | 827.10 | 1374.70 | transfer 1332 |
| R075 | 827.30 | 1379.70 | transfer 9218 |
| R071 | 827.50 | 1387.30 | transfer 1076 |
| R065 | 1135.30 | 1393.50 | transfer 2716 |
| R035 | 1249.30 | 1399.90 | transfer 945 |
| R050 | 1252.20 | 1404.50 | transfer 1061 |
| R085 | 1334.50 | 1339.60 | transfer 17787 |
| R010 | 1383.40 | 1411.80 | transfer 7724 |
| R013 | 1474.80 | 2143.50 | transfer 4900 |
| R079 | 1512.50 | 2626.90 | 200 |
| R052 | 1514.40 | 2658.60 | 200 |
| R041 | 2155.40 | 2636.10 | transfer 976 |
| R040 | 2663.70 | 13053.00 | 200 |
| R093 | 2665.60 | 2668.20 | transfer0（不据此认定cache） |
| R004 | 13067.20 | 13311.60 | 200 |
| R003 | 13313.80 | 14541.10 | 200 |
| R011 | 14542.70 | 14581.70 | 200 |
| R001 | 15063.90 | 15081.80 | 200 / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:miss, quizforge.single-choice:2.0.1:0c96118b163a4af5370eef65b9b3d21fdfc2f844f37f86e33a74ac0850b37a4c:miss, quizforge.richtext:1.1.3:static:miss。

### 200/large/first-b（full01-200-large-0-doc1-2，total 7340.00ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R051 | 24.20 | 6261.80 | 200 |
| R002 | 2675.40 | 6856.30 | 200 |
| R006 | 6267.70 | 7103.90 | 200 |
| R001 | 7205.30 | 7228.60 | 200 / body pending |

应用缓存事件（题目/页面/SDK，含键）：quizforge.multiple-choice:2.0.1:f9e82c7d8cd634cfbf2135ddbe2163091fec8c57393c11a67f70e64cca7ec444:miss, bank:o1-b:q001:miss, quizforge.richtext:1.1.3:static:hit, quizforge.single-choice:2.0.1:0c96118b163a4af5370eef65b9b3d21fdfc2f844f37f86e33a74ac0850b37a4c:hit, quizforge.richtext:1.1.3:static:hit。

### 200/large/return-a（full01-200-large-7-doc1-3，total 824.80ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R040 | 74.40 | 531.60 | 200 |
| R004 | 76.10 | 535.40 | 200 / conditional |
| R001 | 769.00 | 785.90 | 200 / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:revalidate, quizforge.single-choice:2.0.1:e38b696eb33483111f981e29c7768b1dc121197a5987f67033d59d162fd97a57:hit, quizforge.richtext:1.1.3:static:hit。

### 200/large/refresh（full01-200-large-4-doc2-1，total 2127.60ms）

| 请求/资源 | 开始ms | 结束ms | 状态/缓存 |
|---|---|---|---|
| R090 | 55.40 | 103.60 | transfer 10597 |
| R026 | 55.80 | 143.90 | transfer 950 |
| R072 | 56.00 | 152.30 | transfer 11737 |
| R083 | 56.20 | 162.90 | transfer 1885 |
| R066 | 56.50 | 170.90 | transfer 12819 |
| R020 | 56.60 | 178.60 | transfer 3131 |
| R036 | 56.90 | 284.20 | transfer 7971 |
| R076 | 57.10 | 193.10 | transfer 6928 |
| R057 | 57.40 | 199.50 | transfer 1579 |
| R031 | 57.60 | 221.00 | transfer 3024 |
| R017 | 57.80 | 251.90 | transfer 6381 |
| R077 | 58.10 | 336.60 | transfer 5434 |
| R084 | 58.50 | 341.90 | transfer 9345 |
| R037 | 58.70 | 344.00 | transfer 8819 |
| R058 | 59.00 | 348.20 | transfer 7975 |
| R089 | 59.20 | 327.90 | transfer 3384 |
| R041 | 59.60 | 366.60 | transfer 976 |
| R042 | 59.70 | 354.20 | transfer 23772 |
| R078 | 59.90 | 380.60 | transfer 151694 |
| R094 | 60.10 | 127.30 | transfer 70019 |
| R059 | 387.50 | 416.10 | transfer 3069 |
| R021 | 387.80 | 418.70 | transfer 19068 |
| R014 | 388.10 | 424.30 | transfer 967 |
| R018 | 388.30 | 427.80 | transfer 1345 |
| R038 | 388.50 | 433.40 | transfer 3024 |
| R091 | 388.60 | 438.70 | transfer 4927 |
| R086 | 388.80 | 443.80 | transfer 21689 |
| R067 | 388.90 | 451.10 | transfer 1948 |
| R073 | 389.10 | 464.30 | transfer 66127 |
| R068 | 389.20 | 466.30 | transfer 2233 |
| R039 | 389.30 | 420.10 | transfer 4754 |
| R022 | 389.50 | 468.80 | transfer 1585 |
| R032 | 389.50 | 476.20 | transfer 3526 |
| R060 | 389.70 | 482.60 | transfer 2958 |
| R061 | 389.90 | 487.30 | transfer 2287 |
| R053 | 390.00 | 492.50 | transfer 1766 |
| R033 | 390.30 | 498.90 | transfer 4516 |
| R027 | 390.30 | 504.40 | transfer 1261 |
| R043 | 390.50 | 510.40 | transfer 1661 |
| R092 | 390.80 | 516.10 | transfer 1802 |
| R044 | 390.90 | 520.20 | transfer 5207 |
| R080 | 391.00 | 527.50 | transfer 2434 |
| R081 | 391.20 | 535.90 | transfer 2207 |
| R087 | 391.30 | 544.00 | transfer 3074 |
| R082 | 391.80 | 548.10 | transfer 9785 |
| R008 | 391.90 | 554.90 | transfer 2174 |
| R012 | 392.10 | 562.60 | transfer 1995 |
| R088 | 392.20 | 570.80 | transfer 2717 |
| R045 | 392.40 | 577.40 | transfer 4185 |
| R028 | 392.60 | 580.90 | transfer 3487 |
| R029 | 392.90 | 587.30 | transfer 4839 |
| R046 | 393.00 | 593.50 | transfer 3002 |
| R062 | 393.10 | 599.30 | transfer 3229 |
| R063 | 393.60 | 603.10 | transfer 2887 |
| R023 | 393.70 | 608.30 | transfer 1130 |
| R054 | 393.80 | 612.50 | transfer 835 |
| R034 | 393.90 | 616.90 | transfer 3689 |
| R047 | 394.10 | 620.70 | transfer 5002 |
| R048 | 394.10 | 624.40 | transfer 4224 |
| R074 | 394.30 | 630.10 | transfer 7302 |
| R015 | 394.40 | 635.50 | transfer 1710 |
| R016 | 394.50 | 639.50 | transfer 2700 |
| R019 | 394.90 | 644.00 | transfer 1631 |
| R070 | 422.20 | 651.70 | transfer 1144 |
| R055 | 422.40 | 655.50 | transfer 6850 |
| R056 | 422.50 | 662.60 | transfer 8116 |
| R069 | 448.40 | 670.20 | transfer 2706 |
| R009 | 448.60 | 677.10 | transfer 4254 |
| R064 | 448.70 | 687.00 | transfer 6756 |
| R049 | 472.70 | 694.70 | transfer 11239 |
| R024 | 472.90 | 703.20 | transfer 1994 |
| R025 | 473.00 | 711.50 | transfer 1485 |
| R030 | 473.10 | 720.00 | transfer 1332 |
| R075 | 473.30 | 731.00 | transfer 9218 |
| R071 | 473.60 | 738.60 | transfer 1076 |
| R065 | 539.20 | 744.60 | transfer 2716 |
| R035 | 602.30 | 749.90 | transfer 945 |
| R050 | 607.10 | 757.30 | transfer 1061 |
| R085 | 674.50 | 681.60 | transfer 17787 |
| R010 | 735.70 | 764.30 | transfer 7724 |
| R013 | 783.50 | 820.30 | transfer 4900 |
| R079 | 800.80 | 1155.50 | 200 |
| R052 | 801.50 | 1164.90 | 200 |
| R041 | 833.10 | 1163.00 | transfer 976 |
| R040 | 1167.50 | 1356.80 | 200 |
| R093 | 1177.50 | 1179.60 | transfer0（不据此认定cache） |
| R004 | 1362.40 | 1586.20 | 200 |
| R003 | 1587.30 | 1648.90 | 200 |
| R011 | 1651.70 | 1693.50 | 200 |
| R001 | 2024.70 | 2047.40 | 200 / body pending |

应用缓存事件（题目/页面/SDK，含键）：bank:o1-a:q001:miss, quizforge.single-choice:2.0.1:b77fac05753a732650a0900d5ee17a2980f903482076c85e8e16ea1d2eef77d6:miss, quizforge.richtext:1.1.3:static:miss。

请求依赖：初次open先等概览，再loadQuestion，再等页面与SDK，之后mount/onLoad；已有pane恢复路径把loadQuestion与概览置于同一Promise.all并行，之后仍需可用页面/SDK再重建iframe。prefetchAdjacent在showQuestion收尾异步发起，不作为首题必需请求；若瀑布中与其他请求重叠，不能把它们各自时长相加。目录与启动设置也可能并行，精确起止以上表为准。


### 瀑布与表格请求编号

为避免重复长路径遮挡数据，下文R编号为同一实际路径。

| 编号 | 路径 |
|---|---|
| R001 | /api/resources/96fbe7bbe9e76622b6236d0d0fbfddb92f022249ac38bdbbd908efd3bf3791a8 |
| R002 | /api/extensions/quizforge.multiple-choice/2.0.1/page |
| R003 | /api/extensions/quizforge.single-choice/2.0.1/page |
| R004 | /api/collections/bank/o1-a/questions/q001 |
| R005 | /api/collections/bank/o1-a/questions/q002 |
| R006 | /api/collections/bank/o1-b/questions/q001 |
| R007 | /api/collections/bank/o1-b/questions/q002 |
| R008 | /development/development-settings.js |
| R009 | /development/development-preview.js |
| R010 | /shared/answer-area/1.4.0/model.js |
| R011 | /api/sdk/quizforge.richtext/1.1.3 |
| R012 | /development/development-watch.js |
| R013 | /assets/backgrounds/dawn-lake.svg |
| R014 | /library/library-index-client.js |
| R015 | /practice/question-navigation.js |
| R016 | /practice/practice-navigation.js |
| R017 | /library/library-management.css |
| R018 | /practice/collection-loading.js |
| R019 | /practice/practice-lifecycle.js |
| R020 | /practice/practice-summary.css |
| R021 | /listening/listening-player.js |
| R022 | /outline/outline-navigation.js |
| R023 | /library/library-management.js |
| R024 | /draft/whiteboard-selection.js |
| R025 | /shared/answer-area-channel.js |
| R026 | /editor/editor-navigation.css |
| R027 | /practice/practice-summary.js |
| R028 | /practice/practice-context.js |
| R029 | /bridge/extension-requests.js |
| R030 | /shared/ink/1.0.0/renderer.js |
| R031 | /development/development.css |
| R032 | /practice/question-layout.js |
| R033 | /editor/editor-navigation.js |
| R034 | /library/library-transfer.js |
| R035 | /library/extension-groups.js |
| R036 | /shell/network-settings.css |
| R037 | /listening/audio-player.css |
| R038 | /practice/answer-preview.js |
| R039 | /practice/question-cache.js |
| R040 | /api/collections/bank/o1-a |
| R041 | /assets/quizforge-icon.svg |
| R042 | /listening/audio-player.js |
| R043 | /shell/network-settings.js |
| R044 | /outline/outline-resize.js |
| R045 | /draft/draft-fullscreen.js |
| R046 | /bridge/extension-pages.js |
| R047 | /library/library-resize.js |
| R048 | /practice/save-recovery.js |
| R049 | /draft/whiteboard-model.js |
| R050 | /outline/outline-groups.js |
| R051 | /api/collections/bank/o1-b |
| R052 | /api/settings/development |
| R053 | /editor/editor-session.js |
| R054 | /library/native-import.js |
| R055 | /listening/player-drag.js |
| R056 | /draft/whiteboard-dock.js |
| R057 | /shell/admin-contact.css |
| R058 | /listening/listening.css |
| R059 | /shell/workspace-view.js |
| R060 | /history/history-view.js |
| R061 | /history/history-list.js |
| R062 | /library/library-view.js |
| R063 | /outline/outline-view.js |
| R064 | /bridge/frame-capture.js |
| R065 | /shell/admin-contact.js |
| R066 | /shell/refinements.css |
| R067 | /bridge/page-assets.js |
| R068 | /shared/write-queue.js |
| R069 | /bridge/api-bridges.js |
| R070 | /listening/geometry.js |
| R071 | /draft/canvas-space.js |
| R072 | /draft/whiteboard.css |
| R073 | /draft/whiteboard.js |
| R074 | /shell/appearance.js |
| R075 | /draft/answer-ink.js |
| R076 | /ai/ai-settings.css |
| R077 | /exam/exam-mode.css |
| R078 | /ui/quizforge-ui.js |
| R079 | /api/library/index |
| R080 | /ai/ai-settings.js |
| R081 | /ai/user-center.js |
| R082 | /exam/exam-mode.js |
| R083 | /draft/camera.css |
| R084 | /shell/themes.css |
| R085 | /bridge/api-v1.js |
| R086 | /bridge/frame.js |
| R087 | /ai/hub-login.js |
| R088 | /ai/ai-client.js |
| R089 | /ai/ai-chat.css |
| R090 | /shell/app.css |
| R091 | /shared/api.js |
| R092 | /ai/ai-chat.js |
| R093 | /favicon.ico |
| R094 | /app.js |
