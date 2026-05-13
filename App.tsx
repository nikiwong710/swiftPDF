import React, { useState, useRef, useEffect } from 'react';
import { 
  FileText, 
  Image as ImageIcon, 
  Layers, 
  Minimize2, 
  Plus, 
  Trash2, 
  Download, 
  Upload, 
  Send,
  Loader2,
  FileUp,
  X,
  FileImage,
  Combine,
  Scissors,
  CheckCircle2,
  Maximize,
  Type
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import * as fabric from 'fabric';
import { cn } from './lib/utils';
import { detectIntent, ToolAction } from './services/geminiService';

// Setup pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface FileItem {
  id: string;
  file: File;
  preview?: string;
  type: 'pdf' | 'image';
}

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeTool, setActiveTool] = useState<ToolAction | null>(null);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [compressionQuality, setCompressionQuality] = useState(0.5);
  
  // Editor State
  const [showEditor, setShowEditor] = useState(false);
  const [selectedFont, setSelectedFont] = useState('Roboto');
  const [selectedFontSize, setSelectedFontSize] = useState(24);
  const [editorState, setEditorState] = useState<{
    pdfFile: FileItem | null;
    currentPage: number;
    totalPages: number;
    pageEdits: Record<number, any[]>; // JSON of fabric objects per page
  }>({
    pdfFile: null,
    currentPage: 1,
    totalPages: 0,
    pageEdits: {}
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorImageInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fbCanvas = useRef<fabric.Canvas | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file: File) => ({
        id: Math.random().toString(36).substring(7),
        file,
        type: file.type.includes('pdf') ? 'pdf' as const : 'image' as const,
        preview: file.type.includes('image') ? URL.createObjectURL(file) : undefined
      }));
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const handleEditorImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const preview = URL.createObjectURL(file);
      const newItem: FileItem = {
        id: Math.random().toString(36).substring(7),
        file,
        type: 'image',
        preview
      };
      setFiles(prev => [...prev, newItem]);
      addImageToCanvas(newItem);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearFiles = () => setFiles([]);

  // --- PDF Logic ---

  const convertPdfToJpg = async () => {
    const pdfFiles = files.filter(f => f.type === 'pdf');
    if (pdfFiles.length === 0) {
      setStatus("Please upload at least one PDF file.");
      return;
    }

    setProcessing(true);
    setStatus("Converting PDF to JPG...");

    try {
      for (const fileItem of pdfFiles) {
        const arrayBuffer = await fileItem.file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const baseName = fileItem.file.name.replace(/\.pdf$/i, '');
        
        if (pdf.numPages === 1) {
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          if (context) {
            await page.render({ canvasContext: context, viewport }).promise;
            canvas.toBlob((blob) => {
              if (blob) {
                saveAs(blob, `${baseName}.jpg`);
              }
            }, 'image/jpeg', 0.95);
          }
        } else {
          const zip = new JSZip();
          
          for (let i = 1; i <= pdf.numPages; i++) {
            setStatus(`Processing page ${i}/${pdf.numPages} for ${fileItem.file.name}...`);
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            if (context) {
              await page.render({ canvasContext: context, viewport }).promise;
              const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
              if (blob) {
                zip.file(`${baseName}_page_${i}.jpg`, blob);
              }
            }
          }
          
          setStatus(`Generating ZIP for ${fileItem.file.name}...`);
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          saveAs(zipBlob, `${baseName}_images.zip`);
        }
      }
      setStatus("Conversion complete!");
    } catch (err) {
      console.error(err);
      setStatus("Error during conversion.");
    } finally {
      setProcessing(false);
    }
  };

  const convertJpgToPdf = async () => {
    const imageFiles = files.filter(f => f.type === 'image');
    if (imageFiles.length === 0) {
      setStatus("Please upload at least one image.");
      return;
    }

    setProcessing(true);
    setStatus("Creating PDF from images...");

    try {
      const pdfDoc = await PDFDocument.create();
      
      for (const imgFile of imageFiles) {
        const imgBytes = await imgFile.file.arrayBuffer();
        let image;
        
        if (imgFile.file.type === 'image/jpeg' || imgFile.file.type === 'image/jpg') {
          image = await pdfDoc.embedJpg(imgBytes);
        } else if (imgFile.file.type === 'image/png') {
          image = await pdfDoc.embedPng(imgBytes);
        } else {
          continue; // Skip unsupported
        }

        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height,
        });
      }

      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      saveAs(blob, 'converted_images.pdf');
      setStatus("PDF Created!");
    } catch (err) {
      console.error(err);
      setStatus("Error creating PDF.");
    } finally {
      setProcessing(false);
    }
  };

  const mergePdfs = async () => {
    const pdfFiles = files.filter(f => f.type === 'pdf');
    if (pdfFiles.length < 2) {
      setStatus("Please upload at least two PDF files to merge.");
      return;
    }

    setProcessing(true);
    setStatus("Merging PDFs...");

    try {
      const mergedPdf = await PDFDocument.create();
      
      for (const fileItem of pdfFiles) {
        const pdfBytes = await fileItem.file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const pdfBytes = await mergedPdf.save({ useObjectStreams: true });
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      saveAs(blob, 'merged.pdf');
      setStatus("PDFs Merged!");
    } catch (err) {
      console.error(err);
      setStatus("Error merging PDFs.");
    } finally {
      setProcessing(false);
    }
  };

  const compressPdf = async () => {
    const pdfFiles = files.filter(f => f.type === 'pdf');
    if (pdfFiles.length === 0) {
      setStatus("Please upload a PDF to compress.");
      return;
    }

    setProcessing(true);
    setStatus(`Compressing PDF (Quality: ${Math.round(compressionQuality * 100)}%)...`);

    try {
      const fileItem = pdfFiles[0];
      const arrayBuffer = await fileItem.file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      const newPdf = await PDFDocument.create();
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        // Improved resolution mapping:
        // We use a higher scale for better resolution and clarity, 
        // while relying more on JPEG compression for size reduction.
        const scale = 0.6 + (compressionQuality * 0.8); 
        const viewport = page.getViewport({ scale }); 
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        if (context) {
          // Ensure white background for better JPEG compression and removal of transparency
          context.fillStyle = 'white';
          context.fillRect(0, 0, canvas.width, canvas.height);
          
          await page.render({ canvasContext: context, viewport }).promise;
          // Use a balanced quality for JPEG encoding
          const imgDataUrl = canvas.toDataURL('image/jpeg', Math.min(compressionQuality * 0.9, 0.85));
          const imgBytes = await fetch(imgDataUrl).then(res => res.arrayBuffer());
          const embeddedImg = await newPdf.embedJpg(imgBytes);
          
          // Original dimensions are viewport.width / scale
          const originalWidth = viewport.width / scale;
          const originalHeight = viewport.height / scale;
          const newPage = newPdf.addPage([originalWidth, originalHeight]);
          
          newPage.drawImage(embeddedImg, {
            x: 0,
            y: 0,
            width: originalWidth,
            height: originalHeight,
          });
        }
      }

      const savedBytes = await newPdf.save({ 
        useObjectStreams: true,
        addDefaultPage: false,
        updateFieldAppearances: false
      });
      const blob = new Blob([savedBytes], { type: 'application/pdf' });
      
      // Ensure the file size is actually lower than the original
      if (blob.size >= fileItem.file.size) {
        setStatus(`Could not reduce size at ${Math.round(compressionQuality * 100)}% quality. Use a lower setting.`);
        // Note: We still let the process finish, but we warn the user. 
        // To strictly follow "always lower", we can add a secondary check here.
        // If the user wants a hard block:
        setProcessing(false);
        return;
      }

      saveAs(blob, `compressed_${fileItem.file.name}`);
      setStatus("PDF Compressed!");
    } catch (err) {
      console.error(err);
      setStatus("Error compressing PDF.");
    } finally {
      setProcessing(false);
    }
  };

  // --- Editor Logic ---

  useEffect(() => {
    let timer: any;
    if (showEditor && editorState.pdfFile) {
      // Small delay to ensure canvasRef.current is populated after motion.div mount
      timer = setTimeout(() => {
        if (canvasRef.current) {
          initEditorPage(editorState.currentPage);
        } else {
          console.warn("Canvas ref still missing after delay");
          setStatus("Editor preparation failed. Please close and try again.");
        }
      }, 100);
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (fbCanvas.current) {
        fbCanvas.current.dispose();
        fbCanvas.current = null;
      }
    };
  }, [showEditor, editorState.pdfFile, editorState.currentPage]);

  const saveCurrentPageEdits = async () => {
    if (!fbCanvas.current) return;
    const objects = fbCanvas.current.getObjects().slice(1); // Exclude background
    const edits = await Promise.all(objects.map(async obj => obj.toObject()));
    setEditorState(prev => ({
      ...prev,
      pageEdits: { ...prev.pageEdits, [prev.currentPage]: edits }
    }));
  };

  const initEditorPage = async (pageNumber: number) => {
    if (!editorState.pdfFile || !canvasRef.current) {
      console.warn("Editor init skipped: Missing file or canvas ref", { file: !!editorState.pdfFile, canvas: !!canvasRef.current });
      return;
    }

    try {
      setStatus(`Loading page ${pageNumber}...`);
      if (fbCanvas.current) {
        fbCanvas.current.dispose();
      }

      const arrayBuffer = await editorState.pdfFile.file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.5 });

      const offscreenCanvas = document.createElement('canvas');
      const offscreenContext = offscreenCanvas.getContext('2d')!;
      offscreenCanvas.height = viewport.height;
      offscreenCanvas.width = viewport.width;
      
      await page.render({ canvasContext: offscreenContext, viewport }).promise;

      const backgroundDataUrl = offscreenCanvas.toDataURL();

      fbCanvas.current = new fabric.Canvas(canvasRef.current, {
        width: viewport.width,
        height: viewport.height,
        backgroundColor: '#ffffff'
      });

      const backgroundImg = await fabric.FabricImage.fromURL(backgroundDataUrl);
      backgroundImg.set({
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      });
      
      fbCanvas.current.add(backgroundImg);
      fbCanvas.current.sendObjectToBack(backgroundImg);

      // Load existing edits for this page
      const pageEdits = editorState.pageEdits[pageNumber] || [];
      if (pageEdits.length > 0) {
        const enlivened = await fabric.util.enlivenObjects(pageEdits);
        enlivened.forEach((obj: any) => {
          fbCanvas.current?.add(obj);
        });
      }

      // Sync selection with UI
      fbCanvas.current.on('selection:created', (e) => handleSelection(e.selected?.[0]));
      fbCanvas.current.on('selection:updated', (e) => handleSelection(e.selected?.[0]));
      fbCanvas.current.on('selection:cleared', () => handleSelection(null));

      fbCanvas.current.renderAll();
      setEditorState(prev => ({ ...prev, totalPages: pdf.numPages }));
      setStatus(null);
    } catch (err) {
      console.error("Editor Page Init Error:", err);
      setStatus("Error loading page. Try closing and reopening it.");
    }
  };

  const handleSelection = (obj: any) => {
    if (obj instanceof fabric.IText) {
      setSelectedFont(obj.fontFamily || 'Inter');
      setSelectedFontSize(obj.fontSize || 24);
    }
  };

  const updateSelectedText = (updates: Partial<{ fontFamily: string, fontSize: number }>) => {
    if (!fbCanvas.current) return;
    const active = fbCanvas.current.getActiveObject();
    if (active instanceof fabric.IText) {
      active.set(updates);
      fbCanvas.current.renderAll();
    }
  };

  const addTextToCanvas = () => {
    if (!fbCanvas.current) {
      console.warn("Cannot add text: Canvas not ready");
      return;
    }
    try {
      const text = new fabric.IText('Enter text here', {
        left: 50,
        top: 50,
        fontSize: selectedFontSize,
        fontFamily: selectedFont,
        fill: '#000000',
      });
      fbCanvas.current.add(text);
      fbCanvas.current.setActiveObject(text);
      fbCanvas.current.renderAll();
    } catch (err) {
      console.error("Error adding text:", err);
    }
  };

  const addImageToCanvas = async (fileItem: FileItem) => {
    if (!fbCanvas.current || !fileItem.preview) return;

    try {
      const img = await fabric.FabricImage.fromURL(fileItem.preview);
      const canvasWidth = fbCanvas.current.getWidth();
      const scale = (canvasWidth * 0.3) / img.width!;
      img.scale(scale);
      fbCanvas.current.add(img);
      fbCanvas.current.centerObject(img);
      fbCanvas.current.setActiveObject(img);
    } catch (err) {
      console.error("Add Image Error:", err);
    }
  };

  const changePage = async (delta: number) => {
    const next = editorState.currentPage + delta;
    if (next < 1 || next > editorState.totalPages) return;
    
    await saveCurrentPageEdits();
    setEditorState(prev => ({ ...prev, currentPage: next }));
  };

  const finalizeEditAndFlatten = async () => {
    if (!editorState.pdfFile) return;
    setProcessing(true);
    setStatus("Generating flattened PDF...");

    try {
      // Get current page edits SYNC to avoid React state lag
      const currentObjects = fbCanvas.current ? fbCanvas.current.getObjects().slice(1) : [];
      const currentPageEdits = await Promise.all(currentObjects.map(obj => obj.toObject()));
      
      const allPageEdits = { 
        ...editorState.pageEdits, 
        [editorState.currentPage]: currentPageEdits 
      };
      
      const pdfBytes = await editorState.pdfFile.file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pdfPages = pdfDoc.getPages();

      const pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      const numPages = pdfJsDoc.numPages;

      for (let i = 0; i < numPages; i++) {
        const pageIdx = i + 1;
        const pageEdits = allPageEdits[pageIdx] || [];
        if (pageEdits.length === 0) continue;

        const pdfPage = pdfPages[i];
        const { width: pdfWidth, height: pdfHeight } = pdfPage.getSize();
        
        const pdfJsPage = await pdfJsDoc.getPage(pageIdx);
        const viewport = pdfJsPage.getViewport({ scale: 1.5 });
        const editorWidth = viewport.width;
        const editorHeight = viewport.height;

        for (const objData of pageEdits) {
          const enliven = await fabric.util.enlivenObjects([objData]);
          const obj = enliven[0] as any;
          if (!obj) continue;
          
          const scaleX = pdfWidth / editorWidth;
          const scaleY = pdfHeight / editorHeight;

          if (obj.type === 'image' || obj instanceof fabric.FabricImage) {
            const fabricImg = obj as fabric.FabricImage;
            
            // Re-fetch the original source if possible, or use toDataURL
            let imgBytes: ArrayBuffer;
            let isJpg = false;
            
            if (fabricImg.getSrc().startsWith('blob:')) {
              const response = await fetch(fabricImg.getSrc());
              const blob = await response.blob();
              imgBytes = await blob.arrayBuffer();
              isJpg = blob.type === 'image/jpeg' || blob.type === 'image/jpg';
            } else {
              const dataUrl = fabricImg.toDataURL({ format: 'png' });
              imgBytes = await fetch(dataUrl).then(res => res.arrayBuffer());
              isJpg = false;
            }
            
            const embeddedImg = isJpg ? await pdfDoc.embedJpg(imgBytes) : await pdfDoc.embedPng(imgBytes);

            const renderedWidth = (fabricImg.width! * fabricImg.scaleX!) * scaleX;
            const renderedHeight = (fabricImg.height! * fabricImg.scaleY!) * scaleY;
            
            const pdfX = fabricImg.left! * scaleX;
            const pdfY = pdfHeight - (fabricImg.top! * scaleY) - renderedHeight;

            pdfPage.drawImage(embeddedImg, {
              x: pdfX,
              y: pdfY,
              width: renderedWidth,
              height: renderedHeight,
              rotate: degrees(-(fabricImg.angle || 0)),
            });
          } else if (obj.type === 'i-text' || obj instanceof fabric.IText) {
            const fabricText = obj as fabric.IText;
            
            // Simple text drawing. Note: This uses standard fonts as custom font embedding is complex.
            pdfPage.drawText(fabricText.text || "", {
              x: fabricText.left! * scaleX,
              y: pdfHeight - (fabricText.top! * scaleY) - (fabricText.fontSize! * scaleY * 0.8),
              size: fabricText.fontSize! * scaleY,
              color: rgb(0, 0, 0),
              rotate: degrees(-(fabricText.angle || 0)),
            });
          }
        }
      }

      const finalPdfBytes = await pdfDoc.save({ useObjectStreams: true });
      const blob = new Blob([finalPdfBytes], { type: 'application/pdf' });
      saveAs(blob, `edited_${editorState.pdfFile.file.name}`);
      setStatus("PDF Flattened and Downloaded!");
      setShowEditor(false);
    } catch (err) {
      console.error("Flattening Error:", err);
      setStatus("Error flattening PDF.");
    } finally {
      setProcessing(false);
    }
  };

  const editAndFlatten = async () => {
    const pdfFiles = files.filter(f => f.type === 'pdf');
    if (pdfFiles.length === 0) {
      setStatus("Please upload a PDF to edit.");
      return;
    }
    setEditorState({ 
      pdfFile: pdfFiles[0], 
      currentPage: 1, 
      totalPages: 0, 
      pageEdits: {} 
    });
    setShowEditor(true);
  };

  const runTool = () => {
    switch (activeTool) {
      case 'PDF_TO_JPG': convertPdfToJpg(); break;
      case 'JPG_TO_PDF': convertJpgToPdf(); break;
      case 'MERGE_PDF': mergePdfs(); break;
      case 'COMPRESS_PDF': compressPdf(); break;
      case 'EDIT_PDF': editAndFlatten(); break;
      default: setStatus("Select a tool or tell me what to do.");
    }
  };

  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-indigo-500/30">
      <div className="max-w-5xl mx-auto px-6 py-12">
        
        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 mb-2"
            >
              <div className="p-2 bg-indigo-600 rounded-lg">
                <FileText className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-neutral-900 italic">SwiftPDF</h1>
            </motion.div>
            <p className="text-neutral-500 max-w-md">
              Secure, local-first PDF tools. All processing stays in your browser.
            </p>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-neutral-50 transition-colors rounded-full text-sm font-medium border border-neutral-200"
            >
              <Plus className="w-4 h-4" />
              Add Files
            </button>
            <button 
              onClick={clearFiles}
              className="px-4 py-2 text-sm text-neutral-400 hover:text-red-500 transition-colors"
            >
              Clear All
            </button>
            <input 
              type="file" 
              multiple 
              accept=".pdf,image/*" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
            />
          </div>
        </header>

        {/* Operations Tabs */}
        <section className="mb-10">
          <div className="flex flex-wrap gap-2 p-1.5 bg-neutral-100/50 rounded-2xl border border-neutral-200/60">
            {[
              { id: 'PDF_TO_JPG', label: 'PDF to Image', icon: FileImage, color: 'text-orange-500' },
              { id: 'JPG_TO_PDF', label: 'Image to PDF', icon: ImageIcon, color: 'text-blue-500' },
              { id: 'MERGE_PDF', label: 'Merge PDFs', icon: Combine, color: 'text-indigo-600' },
              { id: 'COMPRESS_PDF', label: 'Compress PDF', icon: Minimize2, color: 'text-emerald-600' },
              { id: 'EDIT_PDF', label: 'Edit & Flatten', icon: Scissors, color: 'text-pink-500' }
            ].map((tool) => {
              const Icon = tool.icon;
              const isActive = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  onClick={() => {
                    setActiveTool(tool.id as ToolAction);
                    setStatus(null);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all font-medium text-sm",
                    isActive 
                      ? "bg-white text-neutral-900 shadow-sm border border-neutral-200" 
                      : "text-neutral-500 hover:text-neutral-900 hover:bg-white/50"
                  )}
                >
                  <Icon className={cn("w-4 h-4", tool.color)} />
                  {tool.label}
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            {activeTool === 'COMPRESS_PDF' && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-4 p-4 bg-white rounded-2xl border border-neutral-100 shadow-sm flex flex-col md:flex-row items-center gap-6"
              >
                <div className="flex-1 w-full max-w-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Compression Quality</span>
                    <span className="text-sm font-black text-indigo-600">{Math.round(compressionQuality * 100)}%</span>
                  </div>
                  <input 
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={compressionQuality}
                    onChange={(e) => setCompressionQuality(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <div className="flex justify-between mt-1 px-1">
                    <span className="text-[10px] text-neutral-400">Smaller Size</span>
                    <span className="text-[10px] text-neutral-400">Higher Resolution</span>
                  </div>
                </div>
                <div className="text-xs text-neutral-400 italic md:border-l md:pl-6 border-neutral-100 py-1">
                  Higher quality preserves clarity but results in larger files.
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Area */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Status Message */}
            {status && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                className="p-3 px-4 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-indigo-600 font-medium flex items-center gap-3"
              >
                {processing && <Loader2 className="w-4 h-4 animate-spin" />}
                {status}
              </motion.div>
            )}

            {/* File Gallery */}
            <section className={cn(
              "rounded-3xl border border-dashed border-neutral-200 min-h-[400px] p-6 transition-colors shadow-inner",
              files.length === 0 ? "flex items-center justify-center bg-neutral-50/30" : "bg-neutral-50/50"
            )}>
              {files.length === 0 ? (
                <div className="text-center group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <div className="mb-4 inline-block p-6 bg-neutral-50 rounded-full group-hover:bg-indigo-500/10 transition-colors">
                    <FileUp className="w-12 h-12 text-neutral-400 group-hover:text-indigo-500 transition-colors" />
                  </div>
                  <h3 className="text-lg font-medium text-neutral-600">Drop files here</h3>
                  <p className="text-sm text-neutral-400">PDFs or Images (JPG, PNG)</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  <AnimatePresence>
                    {files.map((fileItem) => (
                      <motion.div 
                        key={fileItem.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="relative group aspect-square bg-white rounded-xl border border-neutral-200 overflow-hidden flex flex-col items-center justify-center p-4 shadow-sm"
                      >
                        {fileItem.type === 'pdf' ? (
                          <FileText className="w-12 h-12 text-indigo-500" />
                        ) : (
                          <img src={fileItem.preview} className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="preview" />
                        )}
                        <span className="mt-2 text-[10px] text-neutral-500 truncate w-full text-center px-2">
                          {fileItem.file.name}
                        </span>
                        <button 
                          onClick={() => removeFile(fileItem.id)}
                          className="absolute top-2 right-2 p-1.5 bg-white/90 hover:bg-red-500 hover:text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all text-neutral-500 shadow-sm border border-neutral-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </section>
          </div>

          {/* Action Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white rounded-3xl p-8 border border-neutral-200 shadow-xl flex flex-col justify-between min-h-[300px]">
              <div>
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-neutral-900">
                  <CheckCircle2 className="w-6 h-6 text-indigo-600" />
                  Ready to Process
                </h2>
                <p className="text-sm text-neutral-500 mb-6">
                  {activeTool ? (
                    <>You've selected <span className="font-bold text-neutral-900">{activeTool.replace(/_/g, ' ')}</span>. Click below to start the operation locally.</>
                  ) : (
                    "Select an operation from the tabs above to begin."
                  )}
                </p>
                
                {files.length > 0 && (
                  <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-100 flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-xl border border-neutral-200 flex items-center justify-center shadow-sm">
                      <FileText className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-neutral-900">{files.length} Files Selected</div>
                      <div className="text-[10px] text-neutral-400 uppercase tracking-widest font-black">Ready</div>
                    </div>
                  </div>
                )}
              </div>

              <motion.button
                disabled={!activeTool || processing || files.length === 0}
                onClick={runTool}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  "w-full mt-8 flex items-center justify-center gap-3 py-5 rounded-2xl font-bold text-white shadow-2xl transition-all text-lg",
                  activeTool && files.length > 0
                    ? "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/40"
                    : "bg-neutral-100 text-neutral-400 cursor-not-allowed border border-neutral-200"
                )}
              >
                {processing ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <Download className="w-6 h-6" />
                )}
                {processing ? "Processing..." : "Process & Download"}
              </motion.button>
            </div>

            <div className="bg-neutral-50 p-6 rounded-3xl border border-neutral-100 text-center">
              <p className="text-[10px] text-neutral-400 leading-relaxed italic uppercase tracking-wider font-bold">
                Privacy Guaranteed: Local Processing Only
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Visual Editor Overlay */}
      <AnimatePresence>
        {showEditor && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-white flex flex-col"
          >
            <header className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between bg-white shadow-sm z-20">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowEditor(false)}
                  className="p-2 hover:bg-neutral-100 rounded-full text-neutral-500 transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
                <div>
                  <h2 className="font-bold text-lg text-neutral-900">Visual PDF Editor</h2>
                  <p className="text-xs text-neutral-500">Add text, images, and edit all pages</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {processing ? (
                  <div className="flex items-center gap-2 px-4 py-2 text-indigo-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm font-medium">Processing...</span>
                  </div>
                ) : (
                  <button 
                    onClick={finalizeEditAndFlatten}
                    className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all font-mono"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    FINALIZE & DOWNLOAD
                  </button>
                )}
              </div>
            </header>

            <main className="flex-1 flex overflow-hidden">
              {/* Toolbar Left */}
              <div className="w-20 border-r border-neutral-200 flex flex-col items-center py-6 gap-6 bg-neutral-50">
                <button 
                  onClick={addTextToCanvas}
                  className="p-3 bg-white hover:bg-neutral-100 border border-neutral-200 rounded-xl text-neutral-600 hover:text-indigo-600 transition-all group"
                  title="Add Text"
                >
                  <Type className="w-6 h-6" />
                  <span className="text-[10px] mt-1 block group-hover:text-indigo-600">Text</span>
                </button>
                
                <button 
                  onClick={() => editorImageInputRef.current?.click()}
                  className="p-3 bg-white hover:bg-neutral-100 border border-neutral-200 rounded-xl text-neutral-600 hover:text-indigo-600 transition-all group"
                  title="Upload Image"
                >
                  <ImageIcon className="w-6 h-6" />
                  <span className="text-[10px] mt-1 block group-hover:text-indigo-600">Image</span>
                  <input 
                    type="file" 
                    className="hidden" 
                    ref={editorImageInputRef} 
                    onChange={handleEditorImageUpload} 
                    accept="image/*"
                  />
                </button>

                <div className="mt-auto flex flex-col items-center gap-4">
                  <button 
                    onClick={() => fbCanvas.current?.getActiveObject() && fbCanvas.current?.remove(fbCanvas.current?.getActiveObject()!)}
                    className="p-3 text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Canvas Area */}
              <div className="flex-1 overflow-auto bg-neutral-100 p-12 flex flex-col items-center relative">
                <div className="bg-white shadow-[0_0_80px_rgba(0,0,0,0.1)] rounded-sm overflow-hidden mb-24">
                  <canvas ref={canvasRef} />
                </div>

                {/* Page Navigation Overlay */}
                <div className="fixed bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-white/90 backdrop-blur-md px-6 py-3 rounded-2xl border border-neutral-200 shadow-xl z-20">
                  <button 
                    onClick={() => changePage(-1)}
                    disabled={editorState.currentPage === 1}
                    className="p-2 text-neutral-400 hover:text-indigo-600 disabled:text-neutral-200 transition-colors"
                  >
                    <Layers className="w-5 h-5 rotate-180" />
                  </button>
                  
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-xs font-black text-neutral-400 tracking-widest uppercase">Page</span>
                    <span className="text-lg font-mono font-black text-neutral-900">
                      {editorState.currentPage} <span className="text-neutral-300">/</span> {editorState.totalPages}
                    </span>
                  </div>

                  <button 
                    onClick={() => changePage(1)}
                    disabled={editorState.currentPage === editorState.totalPages}
                    className="p-2 text-neutral-400 hover:text-indigo-600 disabled:text-neutral-200 transition-colors"
                  >
                    <Layers className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Assets & Tools Panel Right */}
              <div className="w-80 border-l border-neutral-200 p-6 bg-neutral-50 overflow-y-auto">
                
                <section className="mb-8">
                  <h3 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4">Text Styling</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] text-neutral-400 mb-2 block">Font Family</label>
                      <select 
                        value={selectedFont}
                        onChange={(e) => {
                          setSelectedFont(e.target.value);
                          updateSelectedText({ fontFamily: e.target.value });
                        }}
                        className="w-full bg-white border border-neutral-200 rounded-lg py-2 px-3 text-sm outline-none focus:border-indigo-500 shadow-sm"
                        style={{ fontFamily: selectedFont }}
                      >
                        {['Helvetica', 'Arial', 'Roboto', 'San Francisco', 'Open Sans', 'Montserrat', 'Lato', 'Times New Roman', 'Georgia', 'Calibri'].map(font => (
                          <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="flex justify-between mb-2">
                        <label className="text-[10px] text-neutral-400">Size</label>
                        <span className="text-[10px] font-bold text-indigo-600">{selectedFontSize}px</span>
                      </div>
                      <input 
                        type="range"
                        min="8"
                        max="120"
                        value={selectedFontSize}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setSelectedFontSize(val);
                          updateSelectedText({ fontSize: val });
                        }}
                        className="w-full h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                    </div>
                  </div>
                </section>

                <h3 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4">Recent Images</h3>
                <div className="grid grid-cols-2 gap-3">
                  {files.filter(f => f.type === 'image').slice(0, 10).map(img => (
                    <button 
                      key={img.id}
                      onClick={() => addImageToCanvas(img)}
                      className="group relative aspect-square bg-white rounded-lg overflow-hidden border border-neutral-200 hover:border-indigo-300 transition-all shadow-sm"
                    >
                      <img src={img.preview} alt="asset" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                  <button 
                    onClick={() => editorImageInputRef.current?.click()}
                    className="aspect-square bg-white border border-dashed border-neutral-300 rounded-lg flex items-center justify-center text-neutral-400 hover:text-indigo-600 hover:border-indigo-400 transition-all shadow-sm"
                  >
                    <Plus className="w-6 h-6" />
                  </button>
                </div>

                <div className="mt-12 space-y-4">
                   <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                     <h4 className="text-xs font-bold text-indigo-600 mb-2 flex items-center gap-2">
                       <CheckCircle2 className="w-3 h-3" />
                       Pro Tip
                     </h4>
                     <p className="text-[10px] text-neutral-600 leading-relaxed font-mono">
                       Double-click text to edit. Edits are saved automatically when switching pages.
                     </p>
                   </div>
                </div>
              </div>
            </main>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
