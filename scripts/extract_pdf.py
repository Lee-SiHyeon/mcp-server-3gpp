"""
PDF Text Extraction Script for 3GPP Specifications

Usage:
    python scripts/extract_pdf.py

Requirements:
    pip install pymupdf
"""

import os
import fitz  # PyMuPDF

# Paths
RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "raw")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "extracted")

def extract_pdf(pdf_path, output_path):
    """Extract text from PDF file."""
    print(f"Extracting: {pdf_path}")
    
    doc = fitz.open(pdf_path)
    text = ""
    
    for page_num, page in enumerate(doc, 1):
        page_text = page.get_text()
        text += f"\n--- Page {page_num} ---\n{page_text}"
        
        if page_num % 100 == 0:
            print(f"  Processed {page_num} pages...")
    
    doc.close()
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(text)
    
    print(f"  Saved: {output_path} ({len(text):,} characters)")
    return text

def main():
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Check raw directory
    if not os.path.exists(RAW_DIR):
        os.makedirs(RAW_DIR)
        print(f"Created '{RAW_DIR}' directory.")
        print("Please place 3GPP PDF files in this folder and run again.")
        print("\nRecommended files:")
        print("  - ts_124008vXXX.pdf (2G/3G NAS)")
        print("  - ts_124301vXXX.pdf (LTE NAS)")
        print("  - ts_124501vXXX.pdf (5G NAS)")
        print("  - ts_136300vXXX.pdf (E-UTRA Overall)")
        return
    
    # Find PDF files
    pdf_files = [f for f in os.listdir(RAW_DIR) if f.lower().endswith(".pdf")]
    
    if not pdf_files:
        print(f"No PDF files found in '{RAW_DIR}'.")
        print("Please download 3GPP specifications and place them in the raw folder.")
        return
    
    print(f"Found {len(pdf_files)} PDF file(s)")
    
    # Extract each PDF
    for pdf_file in pdf_files:
        pdf_path = os.path.join(RAW_DIR, pdf_file)
        output_file = os.path.splitext(pdf_file)[0] + ".txt"
        output_path = os.path.join(OUTPUT_DIR, output_file)
        
        try:
            extract_pdf(pdf_path, output_path)
        except Exception as e:
            print(f"  Error processing {pdf_file}: {e}")
    
    print("\nExtraction complete!")
    print(f"Text files saved in: {OUTPUT_DIR}")
    print("\nNext step: Run 'node scripts/create_chunks.js' to create chunks.")

if __name__ == "__main__":
    main()
