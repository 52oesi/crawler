const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const XLSX = require('xlsx');
const { runCrawl } = require('./crawler');

let mainWindow;
let lastDetailPath = '';

const FILTER_CONFIG = {
  category: '전기감리',
  region: '강원',
  organization: '한국전력'
};

function logToRenderer(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', msg);
  }
  console.log(msg);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    logToRenderer('[main] 창 로드 완료');
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('start-crawl', async (_, payload) => {
  try {
    logToRenderer('[main] 크롤링 시작');
    logToRenderer(`[main] 요청 파라미터: ${JSON.stringify(payload)}`);
    const result = await runCrawl(payload, logToRenderer);
    lastDetailPath = result?.detailPath || '';
    return { success: true, detailPath: lastDetailPath };
  } catch (err) {
    logToRenderer(`[main] 에러: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('convert-to-excel', async () => {
  try {
    if (!lastDetailPath || !fs.existsSync(lastDetailPath)) {
      throw new Error('저장된 JSON 파일이 없습니다. 먼저 크롤링을 실행하세요.');
    }

    const raw = fs.readFileSync(lastDetailPath, 'utf-8');
    const items = JSON.parse(raw);
    const rows = [
      [
        '년',
        '월',
        '일',
        '순위',
        '공사명',
        '공고번호',
        '종목',
        '지역제한',
        '사정률',
        '기초금액',
        '낙찰',
        '낙찰금액',
        '업체명'
      ]
    ];

    items.forEach((bid) => {
      const 일자Raw = bid['개찰일시'] || '';
      const dateOnly = String(일자Raw).split(' ')[0];
      const dateMatch = dateOnly.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
      const 년 = dateMatch ? dateMatch[1] : '';
      const 월 = dateMatch ? dateMatch[2] : '';
      const 일 = dateMatch ? dateMatch[3] : '';
      const 공사명 = (bid['공사명'] || '').replace(/\s+/g, ' ').trim();
      const 공고번호 = (bid['공고번호'] || '').replace(/\s+/g, ' ').trim();
      const 종목 = bid['종목'] || '';
      const 지역제한 = bid['지역제한'] || '';
      const 사정률 = bid['사정률'] || '';
      const 기초금액 = bid['기초금액'] || '';

      if (Array.isArray(bid['참여업체'])) {
        bid['참여업체'].forEach((company) => {
          rows.push([
            년,
            월,
            일,
            company['순위'] || '',
            공사명,
            공고번호,
            종목,
            지역제한,
            사정률,
            기초금액,
            company['기초대비사정률(%)'] || '',
            company['투찰금액'] || '',
            company['업체명'] || ''
          ]);
        });
      }
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '참여업체목록');

    const outputDir = path.join(os.homedir(), 'Desktop', '전기넷');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const base = path.basename(lastDetailPath, '.json');
    const excelPath = path.join(outputDir, `${base}.xlsx`);
    XLSX.writeFile(wb, excelPath);

    logToRenderer(`[main] Excel 파일 생성 완료: ${excelPath}`);
    return { success: true, excelPath };
  } catch (err) {
    logToRenderer(`[main] convert-to-excel 에러: ${err.message}`);
    return { success: false, error: err.message };
  }
});

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (!nums.length) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

function medianString(values) {
  const list = values
    .map((v) => String(v || '').trim())
    .filter((v) => v);
  if (!list.length) return '';
  list.sort((a, b) => a.localeCompare(b, 'ko'));
  return list[Math.floor((list.length - 1) / 2)];
}

function modeNumber(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (!nums.length) return null;
  const counts = new Map();
  nums.forEach((num) => {
    const key = num.toFixed(6);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let max = 0;
  let modeKey = null;
  let tie = false;
  counts.forEach((count, key) => {
    if (count > max) {
      max = count;
      modeKey = key;
      tie = false;
    } else if (count === max) {
      tie = true;
    }
  });
  if (tie || modeKey === null) return null;
  return Number(modeKey);
}

function parseDateParts(rawDate) {
  const dateOnly = String(rawDate || '').split(' ')[0].trim();
  const match = dateOnly.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  return {
    dateOnly,
    year: match ? match[1] : '',
    month: match ? match[2] : '',
    day: match ? match[3] : ''
  };
}

function buildFilteredRows(items) {
  const filteredBids = items.filter((bid) => {
    const category = String(bid['종목'] || '');
    const region = String(bid['지역제한'] || '');
    const organization = String(bid['발주처'] || '');
    return (
      category.includes(FILTER_CONFIG.category) &&
      region.includes(FILTER_CONFIG.region) &&
      organization.includes(FILTER_CONFIG.organization)
    );
  });

  const dateRateMap = new Map();
  filteredBids.forEach((bid) => {
    const { dateOnly } = parseDateParts(bid['개찰일시']);
    if (!dateOnly) return;
    const subject = String(bid['종목'] || '').trim();
    const region = String(bid['지역제한'] || '').trim();
    const dayKey = `${dateOnly}||${subject}||${region}`;
    const rate = parseNumber(bid['사정률']);
    if (rate === null) return;
    if (!dateRateMap.has(dayKey)) {
      dateRateMap.set(dayKey, []);
    }
    dateRateMap.get(dayKey).push(rate);
  });

  const dateMedianMap = new Map();
  dateRateMap.forEach((rates, dayKey) => {
    dateMedianMap.set(dayKey, median(rates));
  });

  const groupMap = new Map();
  filteredBids.forEach((bid) => {
    const { dateOnly, year, month, day } = parseDateParts(bid['개찰일시']);
    if (!dateOnly) return;
    const companies = Array.isArray(bid['참여업체']) ? bid['참여업체'] : [];
    const subject = String(bid['종목'] || '').trim();
    const region = String(bid['지역제한'] || '').trim();
    companies.forEach((company) => {
      const companyName = String(company['업체명'] || '').trim();
      if (!companyName) return;
      const key = `${dateOnly}||${companyName}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          dateOnly,
          year,
          month,
          day,
          dayKey: `${dateOnly}||${subject}||${region}`,
          companyName,
          companyRates: [],
          bidAmounts: [],
          baseAmounts: [],
          noticeNos: [],
          projectNames: [],
          subjects: [],
          regions: []
        });
      }
      const group = groupMap.get(key);
      group.companyRates.push(
        parseNumber(company['기초대비사정률(%)'])
      );
      group.bidAmounts.push(parseNumber(company['투찰금액']));
      group.baseAmounts.push(parseNumber(bid['기초금액']));
      group.noticeNos.push(bid['공고번호']);
      group.projectNames.push(bid['공사명']);
      group.subjects.push(subject);
      group.regions.push(region);
    });
  });

  const groupedByDate = new Map();
  const summaries = [];
  groupMap.forEach((group) => {
    const companyRateMedian = median(group.companyRates);
    const bidAmountMedian = median(group.bidAmounts);
    const baseAmountMedian = median(group.baseAmounts);
    const noticeMedian = medianString(group.noticeNos);
    const subjectMedian = medianString(group.subjects);
    const regionMedian = medianString(group.regions);
    const projectMedian = medianString(group.projectNames);
    const baselineRate = dateMedianMap.get(group.dayKey) ?? null;
    const diff =
      companyRateMedian !== null && baselineRate !== null
        ? companyRateMedian - baselineRate
        : 0;
    const composedProjectName = `${group.dateOnly} ${
      subjectMedian || projectMedian
    }`.trim();

    const summary = {
      dateOnly: group.dateOnly,
      year: group.year,
      month: group.month,
      day: group.day,
      dayKey: group.dayKey,
      companyName: group.companyName,
      noticeNo: noticeMedian,
      projectName: composedProjectName,
      subject: subjectMedian,
      region: regionMedian,
      baseAmount: baseAmountMedian,
      baselineRate,
      companyRate: companyRateMedian,
      bidAmount: bidAmountMedian,
      diff
    };
    summaries.push(summary);
    if (!groupedByDate.has(group.dayKey)) {
      groupedByDate.set(group.dayKey, []);
    }
    groupedByDate.get(group.dayKey).push(summary);
  });

  groupedByDate.forEach((dateGroups) => {
    const negatives = dateGroups
      .filter((item) => item.diff < 0)
      .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
    negatives.forEach((item, index) => {
      item.rank = -(index + 1);
    });

    const positives = dateGroups
      .filter((item) => item.diff > 0)
      .sort((a, b) => a.diff - b.diff);
    positives.forEach((item, index) => {
      item.rank = index + 1;
    });

    dateGroups
      .filter((item) => item.diff === 0)
      .forEach((item) => {
        item.rank = 0;
      });
  });

  const headers = [
    '년',
    '월',
    '일',
    '순위',
    '공사명',
    '공고번호',
    '종목',
    '지역제한',
    '사정률',
    '기초금액',
    '낙찰',
    '낙찰금액',
    '업체명'
  ];

  const rows = [headers];
  const sorted = summaries.sort((a, b) =>
    a.dateOnly.localeCompare(b.dateOnly, 'ko')
  );
  sorted.forEach((item) => {
    rows.push([
      item.year,
      item.month,
      item.day,
      item.rank ?? '',
      item.projectName,
      item.noticeNo,
      item.subject,
      item.region,
      item.baselineRate ?? '',
      item.baseAmount ?? '',
      item.companyRate ?? '',
      item.bidAmount ?? '',
      item.companyName
    ]);
  });

  return rows;
}

ipcMain.handle('filter-to-excel', async () => {
  try {
    if (!lastDetailPath || !fs.existsSync(lastDetailPath)) {
      throw new Error('저장된 JSON 파일이 없습니다. 먼저 크롤링을 실행하세요.');
    }

    const raw = fs.readFileSync(lastDetailPath, 'utf-8');
    const items = JSON.parse(raw);
    const rows = buildFilteredRows(items);
    if (rows.length <= 1) {
      throw new Error('필터 조건에 맞는 데이터가 없습니다.');
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '필터링결과');

    const outputDir = path.join(os.homedir(), 'Desktop', '전기넷');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const base = path.basename(lastDetailPath, '.json');
    const excelPath = path.join(outputDir, `${base}_filtered.xlsx`);
    XLSX.writeFile(wb, excelPath);

    logToRenderer(`[main] 필터링 Excel 생성 완료: ${excelPath}`);
    return { success: true, excelPath };
  } catch (err) {
    logToRenderer(`[main] filter-to-excel 에러: ${err.message}`);
    return { success: false, error: err.message };
  }
});
