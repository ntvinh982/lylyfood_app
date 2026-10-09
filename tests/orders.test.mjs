import fs from 'node:fs';
import * as H from './harness.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {data,sleep,TODAY,click,q,nav,tabs,ok,finish}=H;
const PW={};
const ms=(name,username,role,pw,extra={})=>{PW[username]=pw;return H.mkStaff(name,username,role,extra)};
const R=d=>H.resetData({data:d,passwords:PW});
const session=(u,p,withX=true)=>{ let XLSX; if(withX){XLSX=require('xlsx')} return H.session(u,p,{XLSX}) };
const openApp=()=>H.openApp();
const loginAs=H.loginAs;
const fake=(w,d,a,extra={})=>H.fake(w,d,a,extra);
const SEED=()=>({
  staff:{a1:ms('Vinh','admin','admin','1111'),c1:ms('Lan','lan','cashier','2222'),sh1:ms('Tuan','tuan','shipper','3333'),sh2:ms('Binh','binh','shipper','4444')},
  menu:{m1:{name:'Cơm gà',price:45000,unit:'Phần',groupId:'g1',active:true}},
  groups:{g1:{name:'Cơm',order:1}},customers:{},settings:{},
  orders:{
    o1:{date:TODAY,time:'07:00',mode:'giao',name:'Khách A',phone:'0900000001',address:'Đường 1',items:[{menuId:'m1',name:'Cơm gà',price:45000,qty:2,note:''}],total:90000,payment:'unpaid',delivered:false,createdAt:1,shipperId:'sh1',shipperName:'Tuan'},
    o2:{date:TODAY,time:'08:00',mode:'giao',name:'Khách B',phone:'0900000002',address:'Đường 2',items:[{menuId:'m1',name:'Cơm gà',price:45000,qty:1,note:''}],total:45000,payment:'unpaid',delivered:false,createdAt:2,shipperId:'sh2',shipperName:'Binh'},
    o3:{date:TODAY,time:'09:00',mode:'giao',name:'Khách C',phone:'0900000003',address:'Đường 3',items:[{menuId:'m1',name:'Cơm gà',price:45000,qty:1,note:''}],total:45000,payment:'unpaid',delivered:false,createdAt:3},
    o4:{date:TODAY,time:'10:00',mode:'lay',name:'Khách D',phone:'0900000004',items:[{menuId:'m1',name:'Cơm gà',price:45000,qty:1,note:''}],total:45000,payment:'unpaid',delivered:false,createdAt:4,shipperId:'sh1'},
    o5:{date:'2020-01-01',time:'07:00',mode:'giao',name:'Khách cũ',items:[],total:0,payment:'unpaid',createdAt:5,shipperId:'sh1'}
  }
});
R(SEED());
(async()=>{
  // ---- SHIPPER ----
  let {w,d}=await session('tuan','3333');
  ok(!!d.querySelector('.top'),'shipper đăng nhập được');
  ok(q(d,'.bnav button').length===2,'shipper chỉ có 2 tab: '+q(d,'.bnav button').map(b=>b.textContent.trim()).join(','));
  ok(!d.querySelector('.newbtn'),'shipper không có nút Tạo đơn');
  const names=q(d,'.ticket h3').map(x=>x.textContent);
  ok(names.length===1&&names[0]==='Khách A','shipper chỉ thấy đơn của mình hôm nay: '+JSON.stringify(names));
  ok(!d.querySelector('.acts')&&!d.querySelector('[data-act="print-all"]'),'shipper không có nút thu tiền/in/giao');
  ok(!d.querySelector('.ticket[data-act]'),'đơn của shipper không bấm sửa được');
  ok(!d.querySelector('[data-act="day"]'),'shipper không đổi ngày được');
  click(w,d.querySelector('.ticket')); await sleep(50);
  ok(d.getElementById('sheet').hidden,'bấm vào đơn không mở form sửa');
  // thử gọi trực tiếp các hành động bị chặn
  const fake=a=>{const b=d.createElement('button');b.dataset.act=a;b.dataset.id='o1';b.dataset.v='cash';d.body.appendChild(b);click(w,b);b.remove()};
  fake('pay'); fake('deliver'); fake('new-order'); fake('sub-staff'); await sleep(100);
  ok(data.orders.o1.payment==='unpaid'&&!data.orders.o1.delivered,'shipper không ghi thu/giao được (dữ liệu giữ nguyên)');
  ok(d.getElementById('sheet').hidden,'shipper không mở được form tạo đơn');
  w.close();
  // ---- SHIPPER 2 ----
  ({w,d}=await session('binh','4444'));
  ok(q(d,'.ticket h3').map(x=>x.textContent).join()==='Khách B','shipper Binh chỉ thấy Khách B');
  w.close();
  // ---- CASHIER (role cũ "staff") ----
  ({w,d}=await session('lan','2222'));
  ok(q(d,'.bnav button').map(b=>b.textContent.trim()).join()==='Đơn hàng,Khách hàng,Cài đặt','thu ngân: tab '+q(d,'.bnav button').map(b=>b.textContent.trim()).join());
  ok(!!d.querySelector('.newbtn'),'thu ngân có nút Tạo đơn');
  ok(d.querySelector('.brand span').textContent.includes('Thu ngân'),'tài khoản staff cũ hiện là Thu ngân');
  ok(q(d,'.ticket h3').length===4,'thu ngân thấy toàn bộ 4 đơn hôm nay: '+q(d,'.ticket h3').length);
  ok(!!d.querySelector('[data-act="print-all"]')&&!!d.querySelector('[data-act="print-one"]'),'thu ngân có nút in bill');
  ok(q(d,'.shp').map(x=>x.textContent).join('|').includes('Chưa gán shipper'),'đơn chưa gán hiện "Chưa gán shipper"');
  const chip=q(d,'.chip').find(c=>c.textContent.startsWith('Chưa gán shipper'));
  ok(chip&&chip.textContent.endsWith('1'),'chip lọc Chưa gán shipper đếm 1 đơn (đơn lấy tại quầy không tính)');
  click(w,q(d,'.bnav button')[2]); await sleep(50);
  ok(!!d.querySelector('[data-act="sub-menu"]'),'thu ngân vào được Danh mục món');
  ok(!d.querySelector('[data-act="sub-staff"]')&&!d.querySelector('[data-act="shop-form"]'),'thu ngân không thấy Nhân viên / Thông tin cửa hàng');
  fake('del-staff'); fake('save-staff'); await sleep(50);
  ok(Object.keys(data.staff).length===4,'thu ngân không xoá/sửa được nhân viên');
  click(w,d.querySelector('[data-act="sub-menu"]')); await sleep(50);
  click(w,d.querySelector('[data-act="edit-menu"]')); await sleep(50);
  ok(!d.querySelector('[data-act="del"]'),'thu ngân không có nút xoá món');
  click(w,d.querySelector('[data-act="close"]'));
  // tạo đơn mới + gán shipper
  click(w,d.querySelector('.newbtn')); await sleep(80);
  const sel=d.getElementById('f_ship');
  ok(!!sel&&[...sel.options].map(o=>o.textContent).join()==='Chưa gán shipper,Binh,Tuan','form đơn có ô chọn shipper: '+(sel?[...sel.options].map(o=>o.textContent).join():'none'));
  click(w,d.querySelector('[data-act="seg"][data-v="lay"]')); ok(d.getElementById('shipWrap').hidden,'chọn "Khách ghé lấy" thì ẩn ô shipper');
  click(w,d.querySelector('[data-act="seg"][data-v="giao"]')); ok(!d.getElementById('shipWrap').hidden,'chọn lại "Giao tận nơi" thì hiện ô shipper');
  d.getElementById('f_name').value='Khách E'; d.getElementById('f_name').dispatchEvent(new w.Event('input',{bubbles:true}));
  click(w,d.querySelector('[data-act="qty"][data-d="1"]'));
  sel.value='sh2';
  d.getElementById('f_date').value=TODAY; // sau 17:00 app mặc định ngày mai, test cần đơn hôm nay
  click(w,d.querySelector('[data-act="save-order"]')); await sleep(150);
  const e=Object.values(data.orders).find(o=>o.name==='Khách E');
  ok(e&&e.shipperId==='sh2'&&e.shipperName==='Binh','đơn mới lưu shipperId=sh2: '+JSON.stringify(e&&[e.shipperId,e.shipperName]));
  w.close();
  // shipper Binh giờ thấy đơn E
  ({w,d}=await session('binh','4444'));
  ok(q(d,'.ticket h3').map(x=>x.textContent).sort().join()==='Khách B,Khách E','shipper Binh thấy thêm đơn mới được gán: '+q(d,'.ticket h3').map(x=>x.textContent).join());
  w.close();
  // ---- TỔNG QUAN + PHÂN SHIPPER (thu ngân) ----
  ({w,d}=await session('lan','2222'));
  const lbtn=v=>d.querySelector(`[data-act="layout"][data-v="${v}"]`);
  ok(!!lbtn('cards')&&!!lbtn('table')&&!!lbtn('assign'),'thu ngân có nút chuyển Thẻ / Tổng quan / Phân shipper');
  click(w,lbtn('table')); await sleep(50);
  ok(d.querySelectorAll('.orow').length===5,'Tổng quan hiện đủ 5 đơn hôm nay: '+d.querySelectorAll('.orow').length);
  ok(d.querySelector('.shell').classList.contains('wide'),'Tổng quan dùng khung rộng');
  const rowTxt=q(d,'.orow').map(r=>r.textContent).join('|');
  ok(rowTxt.includes('Tuan')&&rowTxt.includes('Binh')&&rowTxt.includes('Chưa gán')&&rowTxt.includes('Khách lấy'),'Tổng quan hiện shipper, "Chưa gán" và "Khách lấy"');
  ok(!!d.querySelector('.ofoot')&&d.querySelector('.ofoot').textContent.includes('5 đơn'),'Tổng quan có dòng tổng cuối bảng: '+d.querySelector('.ofoot').textContent);
  ok(!!d.querySelector('.ohead'),'Tổng quan có hàng tiêu đề cột');
  click(w,lbtn('assign')); await sleep(50);
  ok(d.querySelectorAll('.arow').length===4,'Phân shipper chỉ liệt kê đơn giao (4 đơn, bỏ đơn khách lấy): '+d.querySelectorAll('.arow').length);
  ok(q(d,'.chip').map(c=>c.textContent).join('|').includes('Chưa gán'),'Phân shipper có chip lọc theo shipper: '+q(d,'.chip').map(c=>c.textContent).join('|'));
  // gán 1 đơn bằng ô chọn
  const rowC=q(d,'.arow').find(r=>r.textContent.includes('Khách C'));
  const selC=rowC.querySelector('select'); selC.value='sh1'; selC.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(150);
  ok(data.orders.o3.shipperId==='sh1'&&data.orders.o3.shipperName==='Tuan','gán 1 đơn qua ô chọn: o3 -> Tuan');
  // gán hàng loạt: chọn tất cả đơn của Binh rồi chuyển sang Tuan
  click(w,d.querySelector('[data-act="ship-filter"][data-v="sh2"]')); await sleep(50);
  ok(d.querySelectorAll('.arow').length===2,'lọc theo Binh còn 2 đơn (B, E): '+d.querySelectorAll('.arow').length);
  click(w,d.querySelector('[data-act="sel-all"]')); await sleep(50);
  ok(!!d.querySelector('.bulk')&&d.querySelector('.bulk').textContent.includes('Đã chọn 2'),'chọn tất cả -> thanh gán hàng loạt hiện "Đã chọn 2 đơn"');
  ok(d.querySelector('[data-act="bulk-assign"]').disabled,'chưa chọn shipper thì nút Gán bị khoá');
  const bs=d.getElementById('bulkShip'); bs.value='sh1'; bs.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(50);
  ok(!d.querySelector('[data-act="bulk-assign"]').disabled,'chọn shipper xong nút Gán mở khoá');
  click(w,d.querySelector('[data-act="bulk-assign"]')); await sleep(200);
  ok(data.orders.o2.shipperId==='sh1'&&data.orders.o2.shipperName==='Tuan'&&Object.values(data.orders).find(o=>o.name==='Khách E').shipperId==='sh1','gán hàng loạt: 2 đơn của Binh chuyển sang Tuan');
  ok(!d.querySelector('.bulk'),'gán xong tự bỏ chọn, thanh gán hàng loạt biến mất');
  // bỏ gán
  click(w,d.querySelector('[data-act="ship-filter"][data-v="all"]')); await sleep(50);
  click(w,d.querySelector('[data-act="sel-all"]')); await sleep(50);
  const bs2=d.getElementById('bulkShip'); bs2.value='__none'; bs2.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(50);
  click(w,d.querySelector('[data-act="bulk-assign"]')); await sleep(200);
  ok(Object.values(data.orders).filter(o=>o.date===TODAY&&o.mode!=='lay').every(o=>!o.shipperId),'"Bỏ gán" hàng loạt gỡ shipper khỏi toàn bộ đơn giao');
  // đơn khách lấy không bị đụng
  ok(data.orders.o4.shipperId==='sh1','đơn khách ghé lấy không bị gán/bỏ gán hàng loạt');
  w.close();
  // ---- SHIPPER thấy đúng đơn vừa gán, và không có nút đổi chế độ ----
  data.orders.o1.shipperId='sh1'; data.orders.o2.shipperId='sh1'; data.orders.o2.shipperName='Tuan'; data.orders.o1.shipperName='Tuan';
  ({w,d}=await session('tuan','3333'));
  ok(q(d,'.ticket h3').map(x=>x.textContent).sort().join()==='Khách A,Khách B','shipper Tuan chỉ thấy đơn được gán: '+q(d,'.ticket h3').map(x=>x.textContent).join());
  ok(!d.querySelector('[data-act="layout"]')&&!d.querySelector('.layoutbar'),'shipper không có nút đổi chế độ hiển thị');
  const fake2=(a,extra={})=>{const b=d.createElement('button');b.dataset.act=a;Object.assign(b.dataset,extra);d.body.appendChild(b);click(w,b);b.remove()};
  fake2('layout',{v:'assign'}); fake2('bulk-assign'); await sleep(50);
  ok(!d.querySelector('.arow')&&!d.querySelector('.orow'),'shipper bị chặn khi cố bật Tổng quan / Phân shipper');
  // thử gán trực tiếp bằng sự kiện change giả
  const fs=d.createElement('select'); fs.dataset.shipFor='o2'; fs.innerHTML='<option value="sh1" selected>x</option>'; d.body.appendChild(fs);
  const before=data.orders.o2.shipperId; fs.value='sh2'; fs.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(80);
  ok(data.orders.o2.shipperId===before,'shipper không tự gán đơn được (dữ liệu giữ nguyên)');
  w.close();
  // ---- ADMIN ----
  ({w,d}=await session('admin','1111'));
  ok(q(d,'.bnav button').length===4,'quản lý có đủ 4 tab');
  click(w,q(d,'.bnav button')[3]); await sleep(50);
  ok(!!d.querySelector('[data-act="sub-staff"]')&&!!d.querySelector('[data-act="shop-form"]'),'quản lý thấy Nhân viên + Thông tin cửa hàng');
  click(w,d.querySelector('[data-act="sub-staff"]')); await sleep(50);
  const roles=q(d,'.rows .role').map(x=>x.textContent).join();
  ok(roles==='Quản lý,Thu ngân,Shipper,Shipper','danh sách nhân viên hiện đúng vai trò: '+roles);
  click(w,d.querySelector('[data-act="new-staff"]')); await sleep(50);
  ok([...d.getElementById('st_role').options].map(o=>o.textContent).join()==='Quản lý,Thu ngân,Shipper','form nhân viên có 3 vai trò');
  d.getElementById('st_name').value='Hùng'; d.getElementById('st_user').value='hung'; d.getElementById('st_pw').value='bep5555'; d.getElementById('st_role').value='shipper';
  click(w,d.querySelector('[data-act="save-staff"]')); await sleep(150);
  const hung=Object.values(data.staff).find(s=>s.username==='hung');
  ok(hung&&hung.role==='shipper','thêm được tài khoản shipper mới');
  finish();
})().catch(e=>{console.error('ERR',e);process.exit(2)});
