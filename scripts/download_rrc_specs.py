"""
3GPP RRC 규격 자동 다운로드 스크립트 (SIB 상세 정보 포함)
TS 36.331 (LTE RRC), TS 38.331 (NR RRC), TS 25.331 (UMTS RRC)
"""

import os
import urllib.request
import time
import re
import sys

# Windows 콘솔 인코딩 문제 해결
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

RAW_DIR = r"c:\Users\User\Desktop\n8n_comprehension\3gpp_docs\raw"

def get_latest_version(base_url):
    """디렉토리에서 최신 버전 찾기"""
    try:
        req = urllib.request.Request(base_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            html = response.read().decode('utf-8')
        
        # 버전 디렉토리 패턴 찾기: XX.XX.XX_60/
        version_pattern = re.compile(r'(\d{2}\.\d{2}\.\d{2}_60)/')
        versions = version_pattern.findall(html)
        
        if not versions:
            return None
        
        # 중복 제거 및 정렬
        versions = list(set(versions))
        versions.sort(key=lambda x: [int(n) for n in x.split('_')[0].split('.')], reverse=True)
        
        return versions[0]
    except Exception as e:
        print(f"  [WARN] Version detection error: {e}")
        return None

# RRC 규격 다운로드 정보
RRC_SPECS = [
    {
        "name": "ts_136331",
        "series_path": "etsi_ts/136300_136399/136331/",
        "desc": "4G LTE RRC (SIB details)"
    },
    {
        "name": "ts_138331",
        "series_path": "etsi_ts/138300_138399/138331/",
        "desc": "5G NR RRC (SIB details)"
    },
    {
        "name": "ts_125331",
        "series_path": "etsi_ts/125300_125399/125331/",
        "desc": "3G UMTS RRC (SIB details)"
    }
]

def download_file(url, dest_path):
    """파일 다운로드"""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        
        with urllib.request.urlopen(req) as response, open(dest_path, 'wb') as out_file:
            file_size = int(response.headers.get('Content-Length', 0))
            downloaded = 0
            block_size = 8192
            
            while True:
                buffer = response.read(block_size)
                if not buffer:
                    break
                downloaded += len(buffer)
                out_file.write(buffer)
                
                if file_size > 0:
                    progress = (downloaded / file_size) * 100
                    print(f"\r  Progress: {progress:.1f}% ({downloaded / (1024*1024):.1f} MB)", end='', flush=True)
        
        print()  # 줄바꿈
        return True
    except Exception as e:
        print(f"\n  [FAIL] {e}")
        return False

def main():
    print("=" * 60)
    print("3GPP RRC Download (SIB Details - Auto Version Detection)")
    print("=" * 60)
    print(f"\nTotal: {len(RRC_SPECS)} specifications")
    
    os.makedirs(RAW_DIR, exist_ok=True)
    
    downloaded_count = 0
    skipped_count = 0
    
    for spec in RRC_SPECS:
        print(f"\n[Finding] Latest version for: {spec['desc']}")
        
        # ETSI 기본 URL
        base_url = f"https://www.etsi.org/deliver/{spec['series_path']}"
        
        # 최신 버전 탐색
        latest_version = get_latest_version(base_url)
        
        if not latest_version:
            print(f"  [FAIL] Could not find version for {spec['name']}")
            continue
        
        print(f"[Downloading] {spec['desc']} ({latest_version})")
        
        # 규격 번호 변환 (예: ts_136331 -> 136331)
        spec_number = spec['name'].replace('ts_', '').replace('tr_', '')
        
        # 버전 문자열 변환 (18.00.00_60 -> 180000)
        version_str = latest_version.replace('.', '').replace('_60', '')
        
        # PDF 파일명 생성
        if spec['name'].startswith('tr_'):
            pdf_filename = f"tr_{spec_number}v{version_str}p.pdf"
        else:
            pdf_filename = f"ts_{spec_number}v{version_str}p.pdf"
        
        # 다운로드 URL
        url = f"{base_url}{latest_version}/{pdf_filename}"
        
        # 저장 경로
        save_filename = f"{spec['name']}_v{latest_version.replace('_60', '')}.pdf"
        save_path = os.path.join(RAW_DIR, save_filename)
        
        # 이미 존재하는지 확인
        if os.path.exists(save_path):
            file_size_mb = os.path.getsize(save_path) / (1024 * 1024)
            print(f"  [SKIP] {spec['desc']} (already exists: {save_filename}) ")
            skipped_count += 1
            continue
        
        print(f"  URL: {url}")
        
        # 다운로드
        if download_file(url, save_path):
            file_size_mb = os.path.getsize(save_path) / (1024 * 1024)
            print(f"  [OK] Downloaded: {save_path} ({file_size_mb:.1f} MB)")
            downloaded_count += 1
        else:
            if os.path.exists(save_path):
                os.remove(save_path)
        
        # 다운로드 간 대기
        time.sleep(1)
    
    print("\n" + "=" * 60)
    print(f"Download Complete: {downloaded_count + skipped_count}/{len(RRC_SPECS)}")
    print("=" * 60)
    print(f"\nLocation: {RAW_DIR}")
    print("\nNext steps:")
    print("1. Check PDF files")
    print("2. Extract text: python scripts/extract_pdf.py")
    print("3. Create chunks: python scripts/create_chunks_simple.py")

if __name__ == "__main__":
    main()
