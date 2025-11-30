"""
3GPP PCT 규격 자동 다운로드 스크립트 (버전 자동 탐색)
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

# PCT 규격 다운로드 정보 (버전 자동 탐색)
SPECS = [
    {
        "name": "ts_151010-1",
        "series_path": "etsi_ts/151000_151099/15101001/",
        "desc": "2G Protocol"
    },
    {
        "name": "ts_134123-1",
        "series_path": "etsi_ts/134100_134199/13412301/",
        "desc": "3G Protocol"
    },
    {
        "name": "ts_136523-1",
        "series_path": "etsi_ts/136500_136599/13652301/",
        "desc": "4G Protocol"
    },
    {
        "name": "ts_138523-1",
        "series_path": "etsi_ts/138500_138599/13852301/",
        "desc": "5G Protocol"
    },
    {
        "name": "ts_131121",
        "series_path": "etsi_ts/131100_131199/131121/",
        "desc": "USIM"
    },
    {
        "name": "ts_131124",
        "series_path": "etsi_ts/131100_131199/131124/",
        "desc": "USAT"
    },
    {
        "name": "ts_134229-1",
        "series_path": "etsi_ts/134200_134299/13422901/",
        "desc": "4G IMS"
    },
    {
        "name": "ts_134229-5",
        "series_path": "etsi_ts/134200_134299/13422905/",
        "desc": "5G IMS"
    },
    {
        "name": "tr_137901",
        "series_path": "etsi_tr/137900_137999/137901/",
        "desc": "Data Throughput"
    },
    {
        "name": "ts_138300",
        "series_path": "etsi_ts/138300_138399/138300/",
        "desc": "5G Architecture"
    }
]

def download_file(url, dest_path, desc, version):
    """파일 다운로드"""
    print(f"[Downloading] {desc} ({version})")
    print(f"  URL: {url}")
    
    try:
        # User-Agent 추가 (일부 서버에서 차단 방지)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        
        with urllib.request.urlopen(req) as response:
            data = response.read()
            
        with open(dest_path, 'wb') as f:
            f.write(data)
        
        size = os.path.getsize(dest_path) / (1024 * 1024)
        print(f"  [OK] Downloaded: {dest_path} ({size:.1f} MB)\n")
        return True
    except Exception as e:
        print(f"  [FAIL] {e}\n")
        return False

def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    
    print("=" * 60)
    print("3GPP PCT Download (Auto Version Detection)")
    print("=" * 60)
    print(f"\nTotal: {len(SPECS)} specifications\n")
    
    success_count = 0
    
    for spec in SPECS:
        # 파일명 패턴 확인 (버전 없이)
        existing_files = [f for f in os.listdir(RAW_DIR) if f.startswith(spec['name']) and f.endswith('.pdf')]
        
        if existing_files:
            print(f"[SKIP] {spec['desc']} (already exists: {existing_files[0]})\n")
            success_count += 1
            continue
        
        # 최신 버전 자동 탐색
        print(f"[Finding] Latest version for: {spec['desc']}")
        base_url = f"https://www.etsi.org/deliver/{spec['series_path']}"
        
        latest_version = get_latest_version(base_url)
        
        if not latest_version:
            print(f"  [FAIL] Could not find any version\n")
            continue
        
        # PDF 파일명 생성 (ETSI 표준 형식)
        # 예: ts_13412301v150800p.pdf (134123-1 -> 13412301)
        
        # 규격 번호 변환
        if spec['name'].startswith('ts_'):
            base_num = spec['name'].replace('ts_', '')
            # 하이픈 처리: 134123-1 -> 13412301 (하이픈 제거 후 01 추가)
            if '-' in base_num:
                parts = base_num.split('-')
                # 마지막 부분을 2자리로 패딩: -1 -> 01, -5 -> 05
                spec_number = parts[0] + parts[1].zfill(2)
            else:
                spec_number = base_num
        elif spec['name'].startswith('tr_'):
            base_num = spec['name'].replace('tr_', '')
            if '-' in base_num:
                parts = base_num.split('-')
                spec_number = parts[0] + parts[1].zfill(2)
            else:
                spec_number = base_num
        
        version_str = latest_version.replace('.', '').replace('_60', '')
        
        if spec['name'].startswith('tr_'):
            pdf_filename = f"tr_{spec_number}v{version_str}p.pdf"
        else:
            pdf_filename = f"ts_{spec_number}v{version_str}p.pdf"
        
        pdf_url = f"{base_url}{latest_version}/{pdf_filename}"
        dest_path = os.path.join(RAW_DIR, f"{spec['name']}_v{latest_version.replace('_60', '').replace('.', '-')}.pdf")
        
        if download_file(pdf_url, dest_path, spec['desc'], latest_version):
            success_count += 1
        
        time.sleep(2)  # 서버 부하 방지
    
    print("=" * 60)
    print(f"Download Complete: {success_count}/{len(SPECS)}")
    print("=" * 60)
    print(f"\nLocation: {RAW_DIR}")
    print("\nNext steps:")
    print("1. Check PDF files")
    print("2. Extract text: python scripts/extract_pdf.py")
    print("3. Create chunks: python scripts/create_vectordb_openai.py")

if __name__ == "__main__":
    main()
