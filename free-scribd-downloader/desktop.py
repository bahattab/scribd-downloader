"""EB Docs Windows desktop UI. Uses the same sequential queue as the website."""
import os
import subprocess
import sys
from pathlib import Path
import queue
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from desktop_client import LocalEngine

LABELS={'queued':'في الانتظار','processing':'جارٍ تجهيز الملف','ready':'جاهز','failed':'تعذَّر التنزيل','unavailable':'الملف غير متاح','cancelled':'أُلغي','setup_required':'شغِّل Setup-Windows.cmd','human_required':'يتطلَّب تدخُّلًا من المستخدم','limit_exceeded':'تجاوز الحدَّ المسموح','expired':'انتهت الصلاحية'}

class Desktop:
    def __init__(self,root):
        self.root=root;self.engine=LocalEngine();self.client=None;self.events=queue.Queue();self.cancelled=threading.Event();self.thread=None;self.closing=False
        root.title('Free Scribd Downloader');root.geometry('920x680');root.minsize(700,520)
        frame=ttk.Frame(root,padding=20);frame.pack(fill='both',expand=True)
        ttk.Label(frame,text='تنزيل المستندات',font=('Segoe UI',20)).pack(anchor='e')
        ttk.Label(frame,text='أضف حتى 20 رابطًا، كل رابط في سطر. يجري تنزيل الملفات بالتسلسل.').pack(anchor='e',pady=8)
        self.urls=tk.Text(frame,height=7,font=('Segoe UI',11),wrap='none');self.urls.pack(fill='x')
        self.authorized=tk.BooleanVar()
        ttk.Checkbutton(frame,text='أؤكِّد أنَّ لديَّ الحقَّ في تنزيل هذه المستندات.',variable=self.authorized).pack(anchor='e',pady=8)
        folders=ttk.Frame(frame);folders.pack(fill='x')
        downloads=Path.home()/'Downloads'
        self.folder=tk.StringVar(value=str(downloads if downloads.is_dir() else Path.home()))
        self.folder_entry=ttk.Entry(folders,textvariable=self.folder);self.folder_entry.pack(side='left',fill='x',expand=True)
        self.choose=ttk.Button(folders,text='مجلّد الحفظ',command=self.pick);self.choose.pack(side='right',padx=5)
        controls=ttk.Frame(frame);controls.pack(fill='x',pady=12)
        self.start=ttk.Button(controls,text='بدء التنزيل',command=self.begin,state='disabled');self.start.pack(side='right')
        self.cancel=ttk.Button(controls,text='إلغاء المتبقِّي',command=self.cancelled.set,state='disabled');self.cancel.pack(side='right',padx=8)
        ttk.Button(controls,text='فتح مجلّد الحفظ',command=self.open_folder).pack(side='left')
        self.table=ttk.Treeview(frame,columns=('name','status'),show='headings',height=10)
        self.table.heading('name',text='المستند / اسم الملف');self.table.heading('status',text='الحالة')
        self.table.column('name',width=570);self.table.column('status',width=230);self.table.pack(fill='both',expand=True)
        self.status=tk.StringVar(value='جارٍ تشغيل المحرِّك المحلي…');ttk.Label(frame,textvariable=self.status,wraplength=850).pack(anchor='e',pady=10)
        ttk.Label(frame,text='الحدّ: 20 ميغابايت و300 صفحة للملف. احفظ الملفات المسموح لك بالوصول إليها فقط.').pack(anchor='e')
        root.protocol('WM_DELETE_WINDOW',self.close)
        self.thread=threading.Thread(target=self.boot,daemon=True);self.thread.start();root.after(100,self.pump)

    def boot(self):
        try:self.client=self.engine.start();self.events.put(('boot',True))
        except Exception as error:self.events.put(('error',f'تعذَّر تشغيل المحرِّك. تحقَّق من تثبيت Node.js 24 وPython. {type(error).__name__}'))

    def pick(self):
        folder=filedialog.askdirectory(initialdir=self.folder.get())
        if folder:self.folder.set(folder)

    def open_folder(self):
        try:
            path=str(Path(self.folder.get()).resolve())
            if os.name=='nt':os.startfile(path)
            else:subprocess.Popen(['open' if sys.platform=='darwin' else 'xdg-open',path])
        except Exception:messagebox.showerror('المجلّد','تعذَّر فتح مجلّد الحفظ.')

    def begin(self):
        urls=[line.strip() for line in self.urls.get('1.0','end').splitlines() if line.strip()]
        if not 1<=len(urls)<=20 or not self.authorized.get():
            messagebox.showerror('تحقَّق من البيانات','أضف من رابط واحد إلى 20 رابطًا، وأكِّد حقَّ التنزيل.');return
        folder=Path(self.folder.get()).resolve()
        if not folder.is_dir():messagebox.showerror('المجلّد','اختر مجلّد حفظ موجودًا.');return
        for row in self.table.get_children():self.table.delete(row)
        self.cancelled.clear();self.busy(True);self.status.set('جارٍ إضافة الروابط إلى قائمة التنزيل…')
        self.thread=threading.Thread(target=self.run,args=(urls,folder),daemon=True);self.thread.start()

    def busy(self,value):
        for widget in (self.start,self.choose,self.folder_entry):widget.configure(state='disabled' if value else 'normal')
        self.cancel.configure(state='normal' if value else 'disabled')

    def run(self,urls,folder):
        batch_id=None;saved={};failed_saves=set();cancel_sent=False
        try:
            created=self.client.request('/api/batches','POST',{'urls':urls,'authorized':True});batch_id=created['id']
            for attempt in range(7200):
                if self.cancelled.is_set() and not cancel_sent:
                    self.client.request('/api/batches/'+batch_id,'DELETE');cancel_sent=True
                batch=self.client.request('/api/batches/'+batch_id)
                for item in batch['items']:
                    label=LABELS.get(item['status'],item['status']);name=item.get('filename') or item['source']
                    if item['status']=='ready':
                        if item['id'] not in saved and item['id'] not in failed_saves:
                            try:saved[item['id']]=self.client.save(item['download'],folder,name)
                            except Exception:failed_saves.add(item['id'])
                        label='حُفظ في المجلّد' if item['id'] in saved else 'تعذَّر الحفظ في المجلّد'
                        if item['id'] in saved:name=saved[item['id']].name
                    self.events.put(('row',item['id'],name,label))
                self.events.put(('status',f"اكتملت معالجة {batch['processed']} من {batch['total']}؛ حُفظ {len(saved)} ملفًّا؛ تعذَّر حفظ {len(failed_saves)}."))
                if not batch['active']:break
                # Event.wait wakes cancellation immediately, but avoid spinning after cancel.
                if cancel_sent:threading.Event().wait(1)
                else:self.cancelled.wait(1)
            else:raise TimeoutError('Batch polling exceeded limit')
        except Exception as error:
            if batch_id:
                try:self.client.request('/api/batches/'+batch_id,'DELETE')
                except Exception:pass
            self.events.put(('error',f'تعذَّر إكمال القائمة. الملفات التي حُفظت تبقى في المجلّد. ({type(error).__name__})'))
        finally:self.events.put(('done',))

    def pump(self):
        while True:
            try:event=self.events.get_nowait()
            except queue.Empty:break
            if event[0]=='boot':self.start.configure(state='normal');self.status.set('المحرِّك جاهز. أضف الروابط للبدء.')
            elif event[0]=='row':
                _,key,name,status=event
                if self.table.exists(key):self.table.item(key,values=(name,status))
                else:self.table.insert('','end',iid=key,values=(name,status))
            elif event[0] in {'status','error'}:self.status.set(event[1])
            elif event[0]=='done':self.busy(False)
        if self.closing and (self.thread is None or not self.thread.is_alive()):
            try:self.engine.stop()
            finally:self.root.destroy()
            return
        self.root.after(100,self.pump)

    def close(self):
        if self.closing:return
        self.closing=True;self.cancelled.set();self.busy(True);self.status.set('جارٍ إيقاف التنزيل وإغلاق المحرِّك…')

if __name__=='__main__':
    root=tk.Tk();Desktop(root);root.mainloop()
