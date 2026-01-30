const fs = require('fs');
const path = require('path');
const os = require('os');
function loadPuppeteer() {
  try {
    return require('puppeteer-core');
  } catch (err) {
    try {
      return require('puppeteer');
    } catch (fallbackErr) {
      const message =
        "puppeteer-core 모듈이 없습니다. `npm i puppeteer-core` 또는 `npm i puppeteer`를 먼저 설치하세요.";
      throw new Error(message);
    }
  }
}

const puppeteer = loadPuppeteer();
require('dotenv').config();

// 하드코딩 로그인 정보 (필요 시 직접 입력)
const HARDCODED_ID = 'ejwna7';
const HARDCODED_PW = 'ljjsjj7554$';

const outputDir = path.join(os.homedir(), 'Desktop', '전기넷');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 크롬 실행 경로 설정 (Win, Mac, Linux)
function resolveChromePath() {
  if (process.platform === 'win32') {
    const win64 =
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const win32 =
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    return fs.existsSync(win64) ? win64 : win32;
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return '/usr/bin/google-chrome';
}

async function safeEvaluate(page, log, fn, args) {
  try {
    return await page.evaluate(fn, args);
  } catch (err) {
    if (
      String(err?.message || '').includes('Execution context was destroyed')
    ) {
      log('[경고] 페이지 리렌더 감지, evaluate 재시도');
      await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
      return await page.evaluate(fn, args);
    }
    throw err;
  }
}

async function loginJungiNet(page, log) {
  const username = HARDCODED_ID || process.env.JUNGINET_ID || '';
  const password = HARDCODED_PW || process.env.JUNGINET_PW || '';
  if (!username || !password) {
    throw new Error('로그인 정보가 없습니다. HARDCODED_ID/PW 또는 환경변수를 확인하세요.');
  }

  log('[1단계] 전기넷 로그인 페이지 이동');
  await page.goto('https://www.jungi.net/login', {
    waitUntil: 'networkidle2'
  });

  await page.waitForSelector('input[name="id"]', { visible: true });
  await page.type('input[name="id"]', username);
  await page.waitForSelector('input[name="pw"]', { visible: true });
  await page.type('input[name="pw"]', password);
  await page.click('#login_btn');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  log('[로그] 로그인 성공');
}

async function runCrawl(payload, log) {
  const chromePath = resolveChromePath();
  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome 경로를 찾지 못했습니다: ${chromePath}`);
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null
  });

  const page = await browser.newPage();
  try {
    await loginJungiNet(page, log);
    log('[2단계] 경쟁사 분석 페이지 이동');
    await page.goto('https://bnb.jungi.net/rival_submit', {
      waitUntil: 'networkidle2'
    });

    log('[3단계] 경쟁사성향분석 메뉴 클릭');
    await page.waitForSelector('a[menu_name="rival_submit"]', {
      visible: true
    });
    await page.click('a[menu_name="rival_submit"]');
    await page.waitForLoadState?.('networkidle');

    log('[4단계] 분석 조건 설정 적용');
    await page.waitForSelector('#search_option_count', { visible: true });
    await page.waitForSelector('input[name="ipchal_date_start"]', {
      visible: true
    });
    await page.waitForSelector('input[name="ipchal_date_end"]', {
      visible: true
    });

    const countMap = new Map([
      [10, '1'],
      [20, '2'],
      [30, '3'],
      [40, '4'],
      [50, '5'],
      [100, '10'],
      [150, '15'],
      [200, '20'],
      [3000, 'all'] // 3000건 이상 전체 공고 조회
    ]);
    const normalizeCount = (value) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return '20';
      if (countMap.has(num)) return countMap.get(num);
      const candidates = Array.from(countMap.keys());
      const closest = candidates.reduce((prev, curr) =>
        Math.abs(curr - num) < Math.abs(prev - num) ? curr : prev
      );
      return countMap.get(closest);
    };

    const startDate = payload?.startDate || '';
    const endDate = payload?.endDate || '';
    const applyDates = async () => {
      await safeEvaluate(
        page,
        log,
        ({ startDateValue, endDateValue }) => {
          const startEl = document.querySelector(
            'input[name="ipchal_date_start"]'
          );
          const endEl = document.querySelector(
            'input[name="ipchal_date_end"]'
          );

          document
            .querySelectorAll('.dateButton')
            .forEach((btn) => btn.classList.remove('on'));

          const btn =
            document.querySelector('.dateButton') ||
            document.querySelector('.dateButton.on');
          if (btn) {
            btn.setAttribute('start', startDateValue);
            btn.setAttribute('end', endDateValue);
            btn.classList.add('on');
          }

          if (typeof window.updateDateButtonView === 'function') {
            window.updateDateButtonView();
          }

          if (startEl) {
            startEl.value = startDateValue;
          }
          if (endEl) {
            endEl.value = endDateValue;
          }

          const slashStart = startDateValue.replace(/-/g, '/');
          const slashEnd = endDateValue.replace(/-/g, '/');
          const ipchalInputs = Array.from(
            document.querySelectorAll('input[name*="ipchal_date"]')
          );
          ipchalInputs.forEach((input) => {
            const name = (input.getAttribute('name') || '').toLowerCase();
            if (name.includes('start') || name.endsWith('1')) {
              input.value = slashStart;
            } else if (name.includes('end') || name.endsWith('2')) {
              input.value = slashEnd;
            }
          });
        },
        { startDateValue: startDate, endDateValue: endDate }
      );
    };

    await applyDates();
    log(`[로그] 기간 설정: ${startDate} ~ ${endDate}`);
    await new Promise((resolve) => setTimeout(resolve, 600));

    const dateInfo = await safeEvaluate(page, log, () => {
      const startEl = document.querySelector('input[name="ipchal_date_start"]');
      const endEl = document.querySelector('input[name="ipchal_date_end"]');
      const hiddenStart = document.querySelector('input[name="ipchal_date1"]');
      const hiddenEnd = document.querySelector('input[name="ipchal_date2"]');
      const ipchalInputs = Array.from(
        document.querySelectorAll('input[name*="ipchal_date"]')
      ).map((input) => ({
        name: input.getAttribute('name') || '',
        value: input.value || ''
      }));
      return {
        startValue: startEl ? startEl.value : '',
        endValue: endEl ? endEl.value : '',
        hiddenStart: hiddenStart ? hiddenStart.value : '',
        hiddenEnd: hiddenEnd ? hiddenEnd.value : '',
        ipchalInputs
      };
    });
    log(
      `[로그] 기간 적용값: ${dateInfo.startValue} ~ ${dateInfo.endValue} (hidden:${dateInfo.hiddenStart} ~ ${dateInfo.hiddenEnd})`
    );
    log(`[로그] ipchal 입력값: ${JSON.stringify(dateInfo.ipchalInputs)}`);

    log('[5단계] 종목(용역) 설정');
    const servicePartValues = Array.isArray(payload?.servicePartValues)
      ? payload.servicePartValues
      : [payload?.servicePartValue || 'ser_all'];
    try {
      await page.click('.clickButton.category.con');
      await page.waitForSelector('#setting_construct_wrap', { visible: true });

      await page.$$eval(
        '#setting_construct_wrap input.part_select_chk',
        (inputs) => {
          inputs.forEach((input) => {
            if (input.checked) {
              input.checked = false;
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }
      );

      await page.$$eval(
        '#setting_construct_wrap input.part_select_chk.con',
        (inputs, values) => {
          inputs.forEach((input) => {
            if (values.includes(input.value)) {
              input.click();
            }
          });
        },
        servicePartValues
      );

      await page.$eval('#setting_construct_wrap .apply_btn', (btn) => {
        btn.click();
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      log(`[로그] 종목(용역) 적용: ${servicePartValues.join(', ')}`);
    } catch (err) {
      log(`[경고] 종목(용역) 적용 실패: ${err.message}`);
    }

    //[옵션] 업체 검색/적용 단계 비활성화
    log('[5단계] 업체 검색 및 적용');
    await page.waitForSelector('#search_company_type', { visible: true });
    await page.waitForSelector('#search_company_text', { visible: true });
    await page.select('#search_company_type', 'company');
    await page.evaluate(() => {
      const input = document.querySelector('#search_company_text');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    const rawCompanyName = (payload?.companyName || '').trim();
    const companyName = rawCompanyName || '이시에스컴';
    if (!rawCompanyName) {
      log('[로그] 업체명 입력이 비어있어 기본값(이시에스컴)으로 검색합니다.');
    }
    
    await page.click('#search_company_text', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#search_company_text', companyName, { delay: 80 });
    const companyInfo = await safeEvaluate(page, log, () => {
      const input = document.querySelector('#search_company_text');
      return input ? input.value : '';
    });
    log(`[로그] 업체명 적용값: ${companyInfo}`);
    await page.evaluate(() => {
      document.querySelector('.company_search')?.click();
    });

    await page.waitForSelector('.scroll_list_div table tbody', {
      visible: true
    });
    try {
      await page.waitForFunction(
        () => {
          const rows = document.querySelectorAll(
            '.scroll_list_div table tbody tr'
          );
          return rows.length >= 2;
        },
        { timeout: 5000 }
      );
      log('[로그] 업체 검색 결과 로드 완료');
    } catch (err) {
      log(
        `[로그] 업체 검색 결과 로드 실패 (검색 미반영). 업체 조건 없이 진행합니다. (${err.message})`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 800));

    const companyRows = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll('.scroll_list_div table tbody tr')
      );
      return rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((td) =>
          (td.textContent || '').trim()
        );
        return { cells };
      });
    });
    
    const validRows = companyRows.filter((row) => row.cells.length >= 5);
    if (!validRows.length) {
      const listText = await page
        .$eval('.scroll_list_div table tbody', (el) => el.textContent.trim())
        .catch(() => '');
      if (listText.includes('검색하세요') || listText.includes('없습니다')) {
        log('[로그] 업체 검색 결과가 없습니다. 업체 조건 없이 진행합니다.');
      } else {
        log(
          '[로그] 업체 검색 결과 파싱 실패. 업체 조건 없이 진행합니다.'
        );
      }
    } else {
      log(`[로그] 업체 검색 결과 ${companyRows.length}건`);
      log(`[로그] 첫 번째 업체: ${companyRows[0].cells.join(' / ')}`);
    
      const selected = await page
        .evaluate((name) => {
          const rows = Array.from(
            document.querySelectorAll('.scroll_list_div table tbody tr')
          );
          const target =
            rows.find((row) => (row.textContent || '').includes(name)) ||
            rows[0];
          if (!target) return false;
          const checkbox = target.querySelector('input.search_checkbox');
          if (!checkbox) return false;
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          const span = checkbox.closest('.checkButton');
          if (span) {
            span.classList.add('on');
          }
          return checkbox.checked === true;
        }, companyName)
        .catch(() => false);
      if (!selected) {
        log('[로그] 업체 행 선택 실패. 업체 조건 없이 진행합니다.');
      } else {
        await page.evaluate(() => {
          document.querySelector('.company_anl_apply')?.click();
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
        log('[로그] 업체 분석 적용 완료');
        const appliedCompanies = await page
          .evaluate(() => {
            return Array.from(
              document.querySelectorAll(
                '.scroll_list_div input.search_checkbox'
              )
            )
              .filter((cb) => cb.checked)
              .map((cb) => cb.value);
          })
          .catch(() => []);
        if (appliedCompanies.length) {
          log(
            `[검증] 적용된 업체 사업자번호: ${appliedCompanies.join(', ')}`
          );
        }
      }
    }

    const waitCountSelect = async () => {
      await page.waitForSelector('#search_option_count', { visible: true });
    };

    const countValue =
      payload?.noticeCountValue || normalizeCount(payload?.noticeCount);
    await waitCountSelect();
    await page.select('#search_option_count', String(countValue));
    await page.$eval('#search_option_count', (el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    log(`[로그] 공고 수 설정 (최종): ${countValue}`);
    const countInfo = await safeEvaluate(page, log, () => {
      const select = document.querySelector('#search_option_count');
      if (!select) return null;
      const selected = select.options[select.selectedIndex];
      return {
        value: select.value,
        label: selected ? selected.textContent.trim() : ''
      };
    });
    if (countInfo) {
      log(`[로그] 공고 수 적용값: ${countInfo.label} (${countInfo.value})`);
    }

    log('[6단계] 검색 버튼 클릭');
    const searchClicked = await page
      .evaluate(() => {
        const selectorList = [
          'div.btn.btn_01.search.search_toggle',
          'div.btn.btn_01.search',
          'div.btn.search',
          'button.search',
          'a.search'
        ];
        const direct = selectorList
          .map((sel) => document.querySelector(sel))
          .find((el) => el);
        if (direct) {
          direct.click();
          return true;
        }
        const byText = Array.from(
          document.querySelectorAll('button, a, div')
        ).find((el) => (el.textContent || '').trim() === '검색');
        if (byText) {
          byText.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (!searchClicked) {
      log('[경고] 검색 버튼을 찾지 못했습니다.');
    }
    await page
      .waitForResponse(
        (res) => res.url().includes('rival') && res.status() === 200,
        { timeout: 5000 }
      )
      .catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1200));

    log('[7단계] 검색 결과 수집');
    await page.waitForSelector('.x_scroll_div table tbody', {
      visible: true
    });

    let lastPageNum = 1;
    try {
      lastPageNum = await page.$$eval('.paging_wrap a', (anchors) => {
        const nums = anchors
          .map((a) => parseInt(a.getAttribute('page_num') || '', 10))
          .filter((n) => !isNaN(n));
        return nums.length ? Math.max(...nums) : 1;
      });
    } catch {}

    const listItems = [];
    for (let pageIdx = 1; pageIdx <= lastPageNum; pageIdx += 1) {
      if (pageIdx > 1) {
        const firstRow = await page
          .$eval('.x_scroll_div table tbody tr td', (td) =>
            td.textContent.trim()
          )
          .catch(() => '');
        const moved = await page
          .$eval(
            `.paging_wrap a[page_num="${pageIdx}"], .paging_wrap a.pager[page_num="${pageIdx}"]`,
            (el) => {
              el.click();
              return true;
            }
          )
          .catch(() => false);
        if (!moved) {
          break;
        }
        await page
          .waitForFunction(
            (prev) => {
              const td = document.querySelector(
                '.x_scroll_div table tbody tr td'
              );
              return td && td.textContent.trim() !== prev;
            },
            { timeout: 5000 },
            firstRow
          )
          .catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      const pageItems = await page.$$eval(
        '.x_scroll_div table tbody tr',
        (trs) => {
          return trs
            .filter((tr) => tr.querySelectorAll('td').length > 0)
            .map((tr) => {
              const tds = tr.querySelectorAll('td');
              const anchor = tds[2]?.querySelector('a.nbbs_detail_open');
              const code = anchor ? anchor.getAttribute('nbbscode') || '' : '';
              const title = tds[2]?.textContent.trim() || '';
              return {
                no: tds[0]?.textContent.trim() || '',
                openDate: tds[1]?.textContent.trim() || '',
                title,
                organization: tds[3]?.textContent.trim() || '',
                region: tds[4]?.textContent.trim() || '',
                category: tds[5]?.textContent.trim() || '',
                basePrice: tds[6]?.textContent.replace(/,/g, '').trim() || '',
                companyCount: tds[7]?.textContent.replace(/,/g, '').trim() || '',
                bidRate: tds[8]?.textContent.trim() || '',
                rank: tds[9]?.textContent.trim() || '',
                adjustRate: tds[10]?.textContent.trim() || '',
                code
              };
            })
            .filter((item) => item.title && item.code);
        }
      );
      listItems.push(...pageItems);
    }

    if (!listItems.length) {
      const emptyText = await page
        .$eval('.x_scroll_div table tbody', (el) => el.textContent.trim())
        .catch(() => '');
      log(
        `[로그] 검색 결과가 없습니다. (${emptyText || '빈 목록'})`
      );
    }

    const uniqueItems = [];
    const seen = new Set();
    for (const item of listItems) {
      const key = `${item.title}|${item.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueItems.push(item);
    }

    const safeName = (value) =>
      String(value || '')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'result';
    const companyLabel = safeName(payload?.companyName || '이시에스컴');
    const dateLabel = `${safeName(payload?.startDate)}_${safeName(
      payload?.endDate
    )}`.replace(/_+$/, '');
    const basicFileName = `basic_jungiNet_${companyLabel}_${dateLabel}.json`;
    const basicPath = path.join(outputDir, basicFileName);
    const detailFileName = `detail_jungiNet_${companyLabel}_${dateLabel}.json`;
    const detailPath = path.join(outputDir, detailFileName);

    let oldDetailData = [];
    if (fs.existsSync(detailPath)) {
      try {
        oldDetailData = JSON.parse(fs.readFileSync(detailPath, 'utf-8'));
      } catch (err) {
        log(`[경고] 기존 detail JSON 로드 실패: ${err.message}`);
      }
    }
    const oldNoticeNos = new Set(
      oldDetailData
        .map((x) => (x && x['공고번호'] ? String(x['공고번호']).trim() : ''))
        .filter((x) => x)
    );

    const targetItems = [];
    const basicResults = [];
    uniqueItems.forEach((item) => {
      const link = `/detail_nbid/index/nbid${item.code}`;
      targetItems.push(item);
      basicResults.push({
        공사명: item.title,
        상세링크: link
      });
    });

    log(`[로그] 공고 목록 ${targetItems.length}건 수집`);

    let detailPage = await browser.newPage();
    const detailResults = [];
    for (let i = 0; i < targetItems.length; i += 1) {
      const item = targetItems[i];
      const detailUrl = `https://www.jungi.net/detail_nbid?nbbscode=${encodeURIComponent(
        item.code
      )}`;
      log(`[상세] ${i + 1}/${targetItems.length} 접속: ${item.title}`);
      let attempt = 0;
      let completed = false;
      while (attempt < 2 && !completed) {
        try {
          const detailData = await scrapeDetailPage(
            detailPage,
            detailUrl,
            item.title,
            log,
            oldNoticeNos
          );
          if (detailData && detailData.__skip) {
            completed = true;
            continue;
          }
          detailResults.push(detailData);
          completed = true;
        } catch (err) {
          const message = err?.message || String(err);
          const shouldReopen =
            message.includes('detached') ||
            message.includes('Connection closed') ||
            message.includes('Target closed') ||
            message.includes('Session closed') ||
            message.includes('Execution context was destroyed') ||
            detailPage?.isClosed();
          const retryLabel = attempt === 0 ? '재시도' : '최종 실패';
          log(
            `[경고] 상세 수집 ${retryLabel}: ${item.title} - ${message}`
          );
          if (!shouldReopen || attempt >= 1) {
            break;
          }
          try {
            if (detailPage && !detailPage.isClosed()) {
              await detailPage.close();
            }
          } catch {}
          detailPage = await browser.newPage();
        }
        attempt += 1;
      }
    }
    await detailPage.close();

    if (detailResults.length > 0) {
      fs.writeFileSync(
        detailPath,
        JSON.stringify(detailResults, null, 2),
        'utf-8'
      );
      log(`[완료] 상세 데이터 수집 완료: ${detailResults.length}건`);
      log(`[완료] JSON 저장: ${detailPath}`);
    } else {
      log(`[완료] 상세 데이터 수집 완료: 0건 (저장 안 함)`);
    }

    fs.writeFileSync(basicPath, JSON.stringify(basicResults, null, 2), 'utf-8');
    log(`[완료] 기본 목록 저장: ${basicPath}`);
    return {
      detailPath,
      basicPath,
      detailCount: detailResults.length
    };
  } finally {
    await browser.close();
  }
}

/**
 * 상세 페이지 파싱 함수 (참여업체 페이징 포함)
 */
async function scrapeDetailPage(page, detailURL, 공사명, log, noticeSet) {
  await page.goto(detailURL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const detailData = await page.evaluate(() => {
    function getTextAfterTh(thText) {
      const th = Array.from(document.querySelectorAll('table th')).find(
        (t) => t.innerText.trim() === thText
      );
      if (!th) return null;
      const nextTd = th.nextElementSibling;
      return nextTd ? nextTd.innerText.trim() : null;
    }

    function getOverviewTableData() {
      const overview = {};
      const section = document.querySelector('#content1');
      if (!section) return overview;
      const excludedKeys = new Set([
        '공고번호',
        '종목',
        '발주처',
        '지역제한',
        '개찰일시',
        '기초금액',
        '투찰률',
        '예정가격',
        '사정률',
        'A값',
        '참여업체 수',
        '순공사원가',
        '낙찰하한가',
        '나의 투찰금액',
        '나의 사정률'
      ]);
      section.querySelectorAll('table th').forEach((th) => {
        const key = (th.innerText || '').trim();
        if (!key) return;
        if (excludedKeys.has(key)) return;
        const td = th.nextElementSibling;
        if (!td) return;
        const value = (td.innerText || '').replace(/\s+/g, ' ').trim();
        overview[key] = value;
      });
      return overview;
    }

    const rawOpenDate = getTextAfterTh('개찰일시');
    const dateOnly = rawOpenDate ? rawOpenDate.split(' ')[0].trim() : null;

    const rawRate = getTextAfterTh('사정률');
    const rateMatch = rawRate ? rawRate.match(/([\d.]+)/) : null;

    const rawNotice = getTextAfterTh('공고번호') || '';
    const noticeNo = rawNotice
      .replace(/공고문보기|예가산출/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')[0];

    return {
      공사명: null,
      공고번호: noticeNo,
      개찰일시: dateOnly,
      종목: getTextAfterTh('종목'),
      발주처: getTextAfterTh('발주처'),
      지역제한: getTextAfterTh('지역제한'),
      기초금액: getTextAfterTh('기초금액'),
      투찰률: getTextAfterTh('투찰률'),
      예정가격: getTextAfterTh('예정가격'),
      사정률: rateMatch ? rateMatch[1] : null,
      A값: getTextAfterTh('A값'),
      '참여업체 수': getTextAfterTh('참여업체 수'),
      순공사원가: getTextAfterTh('순공사원가'),
      낙찰하한가: getTextAfterTh('낙찰하한가'),
      '나의 투찰금액': getTextAfterTh('나의 투찰금액'),
      공고개요: getOverviewTableData(),
      참여업체: []
    };
  });

  const noticeNo = detailData['공고번호']
    ? String(detailData['공고번호']).trim()
    : '';
  if (noticeNo && noticeSet && noticeSet.has(noticeNo)) {
    log(`[중복 스킵] 공고번호 ${noticeNo} - ${공사명}`);
    return { __skip: true };
  }
  if (noticeNo && noticeSet) {
    noticeSet.add(noticeNo);
  }

  let lastPageNum = 1;
  let hasNextGroup = false;
  try {
    const pageInfo = await page.$$eval('.paging_wrap a', (anchors) => {
      const nums = anchors
        .map((a) => parseInt(a.getAttribute('page_num'), 10))
        .filter((n) => !isNaN(n));
      const maxNum = nums.length ? Math.max(...nums) : 1;
      const next =
        anchors.find((a) => (a.className || '').includes('arrow next')) ||
        anchors.find((a) =>
          ['다음', '>', '»'].includes((a.textContent || '').trim())
        );
      return { maxNum, hasNextGroup: Boolean(next) };
    });
    lastPageNum = pageInfo.maxNum;
    hasNextGroup = pageInfo.hasNextGroup;
  } catch {}


  const participants = [];
  let currentPage = 1;
  while (currentPage <= lastPageNum) {
    if (currentPage > 1) {
      const firstRowText = await page
        .$eval('#company_list table tbody tr td', (td) =>
          td.textContent.trim()
        )
        .catch(() => '');

      const clicked = await page
        .$eval(
          `.paging_wrap a.pager[page_num="${currentPage}"], .paging_wrap a.arrow.next`
        , (el) => {
          el.click();
          return true;
        })
        .catch(() => false);

      if (!clicked) {
        log(`[디테일] ${공사명} - 페이지 이동 실패(${currentPage})`);
        break;
      }

      await page
        .waitForFunction(
          (prev) => {
            const td = document.querySelector(
              '#company_list table tbody tr td'
            );
            return td && td.textContent.trim() !== prev;
          },
          { timeout: 5000 },
          firstRowText
        )
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 400));

      // 다음 그룹의 페이지 번호가 새로 렌더되면 마지막 페이지 값을 갱신
      try {
        lastPageNum = await page.$$eval('.paging_wrap a.pager', (anchors) => {
          const nums = anchors
            .map((a) => parseInt(a.getAttribute('page_num'), 10))
            .filter((n) => !isNaN(n));
          return nums.length ? Math.max(...nums) : 1;
        });
      } catch {}
    }

    const pageParticipants = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll('#company_list table tbody tr')
      ).map((tr) => {
        const tds = tr.querySelectorAll('td');
        return {
          순위: tds[0]?.innerText.trim() || '',
          업체명: tds[2]?.innerText.trim() || '',
          투찰금액: tds[5]?.innerText.trim() || '',
          '기초대비사정률(%)': tds[8]?.innerText.trim() || ''
        };
      });
    });

    log(
      `[디테일] 참여업체 ${currentPage}페이지 수집: ${pageParticipants.length}건 (공사명: ${공사명})`
    );
    participants.push(...pageParticipants);

    currentPage += 1;
  }

  detailData.공사명 = 공사명;
  detailData.참여업체 = participants;
  return detailData;
}

module.exports = { runCrawl };
