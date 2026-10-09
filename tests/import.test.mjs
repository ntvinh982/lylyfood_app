import fs from 'node:fs';
import * as H from './harness.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {data,sleep,TODAY,click,q,nav,tabs,ok,finish}=H;
const iconv=require('iconv-lite'),XLSX=require('xlsx');
async function chooseFile(w,d,buf,name){
  const input=d.getElementById('imp_file');
  const file=new w.File([buf],name);
  Object.defineProperty(input,'files',{value:[file],configurable:true});
  input.dispatchEvent(new w.Event('change',{bubbles:true}));
  await sleep(250);
}
const custByPhone=p=>Object.values(data.customers).find(c=>c.phone===p);
const stat=d=>[...d.querySelectorAll('.impstats .sp')].map(x=>x.textContent).join('|');
const PW={};
const ms=(name,username,role,pw,extra={})=>{PW[username]=pw;return H.mkStaff(name,username,role,extra)};
const R=d=>H.resetData({data:d,passwords:PW});
const session=(u,p,withX=true)=>{ let XLSX; if(withX){XLSX=require('xlsx')} return H.session(u,p,{XLSX}) };
const openApp=()=>H.openApp();
const loginAs=H.loginAs;
const fake=(w,d,a,extra={})=>H.fake(w,d,a,extra);
const fresh=()=>({
  staff:{a1:ms('Vinh','admin','admin','1111'),c1:ms('Lan','lan','cashier','2222'),sh1:ms('Tuan','tuan','shipper','3333',{theme:'dark'})},
  menu:{},groups:{},settings:{},orders:{},
  customers:{
    k1:{name:'Chị Lan',phone:'0903456789',address:'',note:'',createdAt:1},
    k2:{name:'Anh Hưng',phone:'0912.345.678',address:'KTX khu B',note:'VIP',createdAt:2},
    k3:{name:'Cô Hoa',phone:'',address:'Số 5 Trần Hưng Đạo',note:'',createdAt:3}
  }
});
R(fresh());
(async()=>{
  // ---------- Cài đặt: Giao diện lên đầu ----------
  let {w,d}=await session('admin','1111');
  click(w,q(d,'.bnav button')[3]); await sleep(50);
  let labels=q(d,'.sectionlabel').map(x=>x.textContent);
  ok(labels[0]==='Giao diện','quản lý: mục đầu tiên của Cài đặt là Giao diện ('+labels.join(' > ')+')');
  ok(!!d.querySelector('[data-act="imp-open"]'),'quản lý thấy dòng "Nhập khách từ Excel/CSV"');
  w.close();
  ({w,d}=await session('lan','2222'));
  click(w,q(d,'.bnav button')[2]); await sleep(50);
  labels=q(d,'.sectionlabel').map(x=>x.textContent);
  ok(labels[0]==='Giao diện','thu ngân: mục đầu tiên là Giao diện ('+labels.join(' > ')+')');
  ok(!d.querySelector('[data-act="imp-open"]'),'thu ngân KHÔNG thấy dòng nhập khách');
  const fk=(a)=>{const b=d.createElement('button');b.dataset.act=a;d.body.appendChild(b);click(w,b);b.remove()};
  fk('imp-open'); fk('imp-run'); await sleep(50);
  ok(d.getElementById('sheet').hidden,'thu ngân gọi thẳng imp-open cũng không mở được');
  // thu ngân đổi giao diện -> lưu vào tài khoản
  click(w,d.querySelector('[data-act="theme"][data-v="dark"]')); await sleep(100);
  ok(data.staff.c1.theme==='dark','thu ngân chọn giao diện Tối -> lưu vào tài khoản (theme=dark)');
  w.close();
  ({w,d}=await session('tuan','3333'));
  ok(d.documentElement.getAttribute('data-theme')==='dark','shipper có theme=dark trong tài khoản -> đăng nhập tự áp giao diện Tối');
  click(w,q(d,'.bnav button')[1]); await sleep(50);
  ok(q(d,'.sectionlabel')[0].textContent==='Giao diện'&&!d.querySelector('[data-act="imp-open"]'),'shipper: Giao diện ở đầu, không có nhập khách');
  w.close();

  // ---------- CSV UTF-8 có BOM, dấu phẩy, ngoặc kép, xuống dòng trong ô ----------
  R(fresh());
  ({w,d}=await session('admin','1111'));
  click(w,q(d,'.bnav button')[3]); await sleep(50);
  click(w,d.querySelector('[data-act="imp-open"]')); await sleep(60);
  ok(!d.getElementById('sheet').hidden&&!!d.getElementById('imp_file'),'quản lý mở được form nhập khách');
  const csv='﻿STT,Họ tên,Số điện thoại,Địa chỉ,Ghi chú\n'+
    '1,Nguyễn Văn Mới,903111222,"12 Lê Lợi, P.1","Hay gọi\ntrước"\n'+       // thiếu số 0 đầu, có dấu phẩy + xuống dòng
    '2,Chị Lan,0903 456 789,45 Hùng Vương,Khách cũ\n'+                        // trùng khách đã có (k1)
    '3,Anh Hưng,+84912345678,Địa chỉ khác,Ghi chú khác\n'+                    // trùng k2 (định dạng khác)
    '4,Trùng Trong File,0988777666,A,\n'+
    '5,Trùng Trong File 2,0988.777.666,B,\n'+                                   // trùng SĐT trong file
    '6,,,,\n'+                                                                  // dòng trống
    '7,Không SĐT,,Số 9 Cách Mạng,\n'+
    '8,,0977000111,,\n'+                                                        // chỉ có SĐT
    '9,Cô Hoa,,Số 5 Trần Hưng Đạo,Đã có\n';                                   // trùng k3 (không SĐT, cùng tên + địa chỉ)
  await chooseFile(w,d,Buffer.from(csv,'utf8'),'khach.csv');
  ok(!!d.getElementById('impm_name'),'đọc được CSV, hiện bước ghép cột');
  const sel=k=>d.getElementById('impm_'+k);
  const lbl=k=>sel(k).selectedOptions[0].textContent;
  ok(lbl('name').startsWith('Họ tên')&&lbl('phone').startsWith('Số điện thoại')&&lbl('address').startsWith('Địa chỉ')&&lbl('note').startsWith('Ghi chú'),'tự nhận đúng 4 cột dù có cột STT: '+['name','phone','address','note'].map(lbl).join(' / '));
  ok(d.getElementById('imp_hdr').checked,'tự nhận dòng đầu là tiêu đề');
  console.log('   thống kê (chế độ bổ sung):',stat(d));
  // thêm mới: Mới(903111222), Trùng Trong File(0988777666), Không SĐT, 0977000111 = 4
  ok(stat(d)==='Thêm mới 4|Cập nhật 2|Bỏ qua 2','chế độ "Bổ sung ô trống": mới 4, cập nhật 2 (Chị Lan, Cô Hoa), bỏ qua 2 (Anh Hưng đã đủ thông tin + 1 trùng trong file) -> '+stat(d));
  click(w,d.querySelector('[data-act="imp-mode"][data-v="skip"]')); await sleep(50);
  ok(stat(d)==='Thêm mới 4|Cập nhật 0|Bỏ qua 4','chế độ "Bỏ qua": cập nhật 0, bỏ qua 4 (3 khách cũ + 1 trùng trong file) -> '+stat(d));
  click(w,d.querySelector('[data-act="imp-mode"][data-v="fill"]')); await sleep(50);
  const before=Object.keys(data.customers).length;
  click(w,d.getElementById('impRun')); await sleep(400);
  ok(Object.keys(data.customers).length===before+4,'đã thêm 4 khách mới: '+before+' -> '+Object.keys(data.customers).length);
  const m=custByPhone('0903111222');
  ok(m&&m.name==='Nguyễn Văn Mới'&&m.address==='12 Lê Lợi, P.1'&&m.note==='Hay gọi\ntrước','mất số 0 đầu được thêm lại + ngoặc kép/dấu phẩy/xuống dòng đúng: '+JSON.stringify(m&&[m.phone,m.address,m.note]));
  ok(!!custByPhone('0988777666')&&Object.values(data.customers).filter(c=>c.phone==='0988777666').length===1,'SĐT trùng trong file chỉ nhập 1 lần');
  ok(Object.values(data.customers).some(c=>c.name==='Không SĐT'&&c.phone===''),'khách không có SĐT vẫn được nhập');
  ok(custByPhone('0977000111').name==='0977000111','dòng chỉ có SĐT -> dùng SĐT làm tên');
  ok(data.customers.k1.address==='45 Hùng Vương'&&data.customers.k1.note==='Khách cũ'&&data.customers.k1.name==='Chị Lan','bổ sung: khách cũ k1 được điền địa chỉ + ghi chú còn trống, giữ tên');
  ok(data.customers.k2.address==='KTX khu B'&&data.customers.k2.note==='VIP'&&data.customers.k2.name==='Anh Hưng','bổ sung: khách cũ k2 đã đủ thông tin nên không bị đổi (+84912345678 vẫn nhận ra là cùng số 0912.345.678)');
  ok(data.customers.k3.note==='Đã có','khách không SĐT (Cô Hoa) khớp theo tên + địa chỉ, bổ sung ghi chú');
  ok(q(d,'.impdone').length===1&&d.querySelector('.impdone').textContent.includes('4 khách mới'),'hiện màn hình kết quả: '+d.querySelector('.impdone').textContent.trim());
  click(w,d.querySelector('[data-act="imp-view"]')); await sleep(80);
  ok(q(d,'.bnav button[aria-current="page"]')[0].textContent.includes('Khách hàng')&&d.getElementById('sheet').hidden,'"Xem danh sách khách" chuyển sang tab Khách hàng');
  w.close();

  // ---------- chế độ Ghi đè ----------
  R(fresh());
  ({w,d}=await session('admin','1111'));
  click(w,q(d,'.bnav button')[3]); await sleep(50); click(w,d.querySelector('[data-act="imp-open"]')); await sleep(60);
  await chooseFile(w,d,Buffer.from('Tên;SĐT;Địa chỉ\nAnh Hưng Mới;0912345678;Địa chỉ mới\n','utf8'),'ds.csv');
  ok(lbl2(d,'phone').startsWith('SĐT'),'CSV dấu ; và tiêu đề "SĐT" được nhận');
  click(w,d.querySelector('[data-act="imp-mode"][data-v="over"]')); await sleep(50);
  click(w,d.getElementById('impRun')); await sleep(300);
  ok(data.customers.k2.name==='Anh Hưng Mới'&&data.customers.k2.address==='Địa chỉ mới'&&data.customers.k2.note==='VIP','"Ghi đè": đổi tên + địa chỉ, giữ ghi chú VIP khi file không có cột này');
  w.close();

  // ---------- xlsx ----------
  R(fresh());
  ({w,d}=await session('admin','1111'));
  click(w,q(d,'.bnav button')[3]); await sleep(50); click(w,d.querySelector('[data-act="imp-open"]')); await sleep(60);
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet([['Khách hàng','Điện thoại','Địa chỉ giao','Ghi chú'],['Công ty ABC',909090909,'Số 5 Trần Hưng Đạo','Đặt 10 phần'],['Quán Cô Ba','0911 222 333','Chợ nổi','']]);
  XLSX.utils.book_append_sheet(wb,ws,'Danh sách');
  const xbuf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  await chooseFile(w,d,xbuf,'khach.xlsx');
  ok(!!d.getElementById('impm_name')&&d.getElementById('impm_name').selectedOptions[0].textContent.startsWith('Khách hàng'),'đọc được .xlsx, nhận cột "Khách hàng" = Tên');
  ok(d.getElementById('impm_address').selectedOptions[0].textContent.startsWith('Địa chỉ giao'),'nhận cột "Địa chỉ giao" = Địa chỉ');
  click(w,d.getElementById('impRun')); await sleep(300);
  ok(!!custByPhone('0909090909')&&custByPhone('0909090909').name==='Công ty ABC','xlsx: số lưu dạng số 909090909 được thêm lại số 0 đầu');
  ok(!!custByPhone('0911222333'),'xlsx: "0911 222 333" được chuẩn hoá thành 0911222333');
  w.close();
  // .xlsx khi không tải được thư viện -> báo lỗi thân thiện, không văng
  R(fresh());
  ({w,d}=await session('admin','1111',false));
  w.document.head.appendChild=el=>{ setTimeout(()=>el.onerror&&el.onerror(new w.Event('error')),10); return el };
  click(w,q(d,'.bnav button')[3]); await sleep(50); click(w,d.querySelector('[data-act="imp-open"]')); await sleep(60);
  await chooseFile(w,d,xbuf,'khach.xlsx');
  ok(d.getElementById('toast').textContent.includes('Không đọc được file')&&!d.getElementById('impm_name'),'không tải được bộ đọc Excel -> báo lỗi rõ ràng, gợi ý dùng .csv');
  w.close();

  // ---------- CSV Windows-1258 (Excel cũ lưu ANSI) + không có tiêu đề ----------
  R(fresh());
  ({w,d}=await session('admin','1111'));
  click(w,q(d,'.bnav button')[3]); await sleep(50); click(w,d.querySelector('[data-act="imp-open"]')); await sleep(60);
  const ansi=iconv.encode('Lê Văn Đông,0933444555,Cà Mau\nBà Sáu,0933444666,Ô Môn\n','win1258');
  await chooseFile(w,d,ansi,'cu.csv');
  ok(!d.getElementById('imp_hdr').checked,'file không tiêu đề: tự bỏ tick "Dòng đầu là tiêu đề"');
  ok(lbl2(d,'phone').includes('0933444555')&&lbl2(d,'name').includes('Lê Văn Đông'),'không tiêu đề: đoán đúng cột SĐT theo nội dung, tên đọc đúng dấu từ Windows-1258: '+lbl2(d,'name'));
  w.close();

  // ---------- dán từ Excel (tab) ----------
  R(fresh());
  ({w,d}=await session('admin','1111'));
  click(w,q(d,'.bnav button')[3]); await sleep(50); click(w,d.querySelector('[data-act="imp-open"]')); await sleep(60);
  d.getElementById('imp_paste').value='Tên\tSĐT\tĐịa chỉ\nBác Tư\t0944555666\t12, Nguyễn Trãi\nChú Bảy\t0944555777\t';
  click(w,d.querySelector('[data-act="imp-paste"]')); await sleep(80);
  ok(stat(d)==='Thêm mới 2|Cập nhật 0|Bỏ qua 0','dán dữ liệu (tab) đọc được 2 khách: '+stat(d));
  click(w,d.querySelector('[data-act="imp-template"]')); await sleep(80);
  const tplTxt=await new Promise(r=>{const f=new w.FileReader();f.onload=()=>r(f.result);f.readAsText(w.__saved[w.__saved.length-1])});
  ok(w.__lastDownload==='mau-nhap-khach.csv'&&tplTxt.includes('Số điện thoại'),'tải được file mẫu .csv');
  w.close();

  finish();
})().catch(e=>{console.error('ERR',e);process.exit(2)});
function lbl2(d,k){return d.getElementById('impm_'+k).selectedOptions[0].textContent}
