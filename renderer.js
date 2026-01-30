window.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const convertBtn = document.getElementById('convertBtn');
  const filterBtn = document.getElementById('filterBtn');
  const logArea = document.getElementById('logArea');

  const companyInput = document.getElementById('companyInput');
  const countInput = document.getElementById('countInput');
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const servicePartSelect = document.getElementById('servicePartSelect');
  const servicePartToggle = document.getElementById('servicePartToggle');

  if (!startBtn || !convertBtn || !filterBtn || !logArea) {
    console.error('[렌더러] 필수 요소를 찾을 수 없습니다.');
    return;
  }

  if (servicePartToggle && servicePartSelect) {
    servicePartToggle.addEventListener('click', () => {
      const isHidden = servicePartSelect.classList.toggle('hidden');
      servicePartToggle.textContent = isHidden ? '펼치기' : '접기';
    });
  }

  logArea.value += '[렌더러] 초기화 완료\n';

  if (window.electronAPI?.onLogMessage) {
    window.electronAPI.onLogMessage((msg) => {
      logArea.value += msg + '\n';
      logArea.scrollTop = logArea.scrollHeight;
    });
  } else {
    logArea.value += '[렌더러] electronAPI 로드 실패 (preload 확인 필요)\n';
  }

  startBtn.addEventListener('click', async () => {
    logArea.value = '';

    const companyName = companyInput?.value.trim() || '이시에스컴';
    const noticeCountValue = countInput?.value || '20';
    const noticeCount = Number(noticeCountValue) || 200;
    const startDate = startDateInput?.value || '';
    const endDate = endDateInput?.value || '';
    const servicePartValues = servicePartSelect
      ? Array.from(
          servicePartSelect.querySelectorAll('input[type="checkbox"]:checked')
        ).map((input) => input.value)
      : ['ser_all'];
    const finalServiceValues =
      servicePartValues.length > 0 ? servicePartValues : ['ser_all'];

    logArea.value += `[렌더러] 크롤링 요청\n`;
    logArea.value += `- 업체명: ${companyName}\n`;
    logArea.value += `- 공고 수: ${noticeCount} (옵션:${noticeCountValue})\n`;
    logArea.value += `- 기간: ${startDate} ~ ${endDate}\n`;
    logArea.value += `- 종목(용역): ${finalServiceValues.join(', ')}\n`;

    if (!window.electronAPI?.startCrawl) {
      logArea.value += '[렌더러] startCrawl 호출 실패 (preload 확인 필요)\n';
      return;
    }

    try {
      const res = await window.electronAPI.startCrawl({
        companyName,
        noticeCount,
        noticeCountValue,
        startDate,
        endDate,
        servicePartValues: finalServiceValues
      });

      if (res.success) {
        logArea.value += `[렌더러] 1~2단계 완료\n`;
      } else {
        logArea.value += `[렌더러] 실패: ${res.error}\n`;
      }
    } catch (err) {
      logArea.value += `[렌더러] 오류: ${err.message}\n`;
    }
  });

  convertBtn.addEventListener('click', async () => {
    if (!window.electronAPI?.convertToExcel) {
      logArea.value += '[렌더러] convertToExcel 호출 실패 (preload 확인 필요)\n';
      return;
    }

    logArea.value += '[렌더러] 엑셀 변환 요청\n';
    try {
      const res = await window.electronAPI.convertToExcel();
      if (res.success) {
        logArea.value += `[렌더러] 엑셀 생성 완료: ${res.excelPath}\n`;
      } else {
        logArea.value += `[렌더러] 엑셀 변환 실패: ${res.error}\n`;
      }
    } catch (err) {
      logArea.value += `[렌더러] 엑셀 오류: ${err.message}\n`;
    }
  });

  filterBtn.addEventListener('click', async () => {
    if (!window.electronAPI?.filterToExcel) {
      logArea.value += '[렌더러] filterToExcel 호출 실패 (preload 확인 필요)\n';
      return;
    }

    logArea.value += '[렌더러] 필터링 엑셀 변환 요청\n';
    try {
      const res = await window.electronAPI.filterToExcel();
      if (res.success) {
        logArea.value += `[렌더러] 필터링 엑셀 생성 완료: ${res.excelPath}\n`;
      } else {
        logArea.value += `[렌더러] 필터링 엑셀 실패: ${res.error}\n`;
      }
    } catch (err) {
      logArea.value += `[렌더러] 필터링 엑셀 오류: ${err.message}\n`;
    }
  });
});
  