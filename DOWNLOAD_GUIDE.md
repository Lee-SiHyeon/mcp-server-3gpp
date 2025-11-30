# 3GPP 규격 다운로드 가이드

## 자동 다운로드 (일부 성공 가능)

```bash
npm run download-pdfs
```

## 수동 다운로드 (권장)

3GPP FTP 서버에서 다운로드:

### NAS Layer
- [TS 24.008](https://www.3gpp.org/ftp/Specs/archive/24_series/24.008/) - 2G/3G NAS
- [TS 24.301](https://www.3gpp.org/ftp/Specs/archive/24_series/24.301/) - LTE NAS
- [TS 24.501](https://www.3gpp.org/ftp/Specs/archive/24_series/24.501/) - 5G NAS

### RF
- [TS 36.521-1](https://www.3gpp.org/ftp/Specs/archive/36_series/36.521-1/) - 4G RF
- [TS 38.521-1](https://www.3gpp.org/ftp/Specs/archive/38_series/38.521-1/) - 5G RF FR1

### Protocol
- [TS 36.523-1](https://www.3gpp.org/ftp/Specs/archive/36_series/36.523-1/) - 4G Protocol
- [TS 38.523-1](https://www.3gpp.org/ftp/Specs/archive/38_series/38.523-1/) - 5G Protocol

### 다운로드 방법
1. 위 링크 접속
2. 최신 버전 ZIP 다운로드 (예: 36521-1-h70.zip)
3. ZIP 압축 해제
4. PDF 파일을 `raw/` 폴더에 복사

### 처리
```bash
npm run prepare-data
```
