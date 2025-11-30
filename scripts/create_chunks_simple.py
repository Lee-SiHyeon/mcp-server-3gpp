"""
간단한 청크 생성 스크립트 (임베딩 없이)
MCP 서버용 chunks.json 생성
"""

import json
import re
from pathlib import Path

# 경로 설정
PROCESSED_DIR = Path(r"c:\Users\User\Desktop\n8n_comprehension\3gpp_docs\processed")
OUTPUT_FILE = Path(r"c:\Users\User\Desktop\n8n_comprehension\3gpp_docs\chunks\chunks.json")

def load_documents():
    """processed 폴더에서 텍스트 파일 로드"""
    documents = []
    txt_files = list(PROCESSED_DIR.glob("*.txt"))
    
    print(f"Found {len(txt_files)} text file(s)")
    
    for txt_path in txt_files:
        # 빈 파일 건너뛰기
        if txt_path.stat().st_size == 0:
            print(f"[SKIP] Empty file: {txt_path.name}")
            continue
            
        print(f"Loading: {txt_path.name}")
        with open(txt_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # 규격명 추출
        spec_name = txt_path.stem
        
        documents.append({
            "content": content,
            "source": spec_name
        })
        print(f"  Size: {len(content):,} characters")
    
    return documents

def chunk_text(text, chunk_size=3000, overlap=200):
    """텍스트를 청크로 분할"""
    chunks = []
    
    # 페이지 마커 제거
    text = re.sub(r'\n--- Page \d+/\d+ ---\n', '\n', text)
    
    # 문단 단위로 분할
    paragraphs = re.split(r'\n\n+', text)
    
    current_chunk = ""
    
    for para in paragraphs:
        # 빈 문단 건너뛰기
        if not para.strip():
            continue
        
        # 청크가 너무 커지면 저장하고 새로 시작
        if len(current_chunk) + len(para) > chunk_size and current_chunk:
            chunks.append(current_chunk.strip())
            # 오버랩을 위해 마지막 부분 일부 포함
            current_chunk = current_chunk[-overlap:] if len(current_chunk) > overlap else ""
        
        current_chunk += para + "\n\n"
    
    # 마지막 청크
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    return chunks

def create_chunks():
    """모든 문서를 청크로 분할하고 JSON으로 저장"""
    
    print("\n" + "="*60)
    print("Loading documents...")
    print("="*60)
    
    documents = load_documents()
    
    print("\n" + "="*60)
    print("Creating chunks...")
    print("="*60)
    
    all_chunks = []
    
    for doc in documents:
        print(f"\nProcessing: {doc['source']}")
        chunks = chunk_text(doc['content'])
        print(f"  Created {len(chunks)} chunks")
        
        # 메타데이터와 함께 저장
        for i, chunk in enumerate(chunks):
            all_chunks.append({
                "text": chunk,
                "spec": doc['source'],
                "chunk_id": f"{doc['source']}_{i}"
            })
    
    # chunks 폴더 생성
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    # JSON 저장
    print("\n" + "="*60)
    print(f"Saving to: {OUTPUT_FILE}")
    print("="*60)
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(all_chunks, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ Total chunks created: {len(all_chunks):,}")
    print(f"📁 Saved to: {OUTPUT_FILE}")
    print(f"📊 File size: {OUTPUT_FILE.stat().st_size / (1024*1024):.1f} MB")

if __name__ == "__main__":
    create_chunks()
