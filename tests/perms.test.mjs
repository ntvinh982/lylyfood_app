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
const setPerms=(id,p)=>{if(p===undefined) delete data.staff[id].perms; else data.staff[id].perms=p};
(async()=>{
  // ===== 1. Thu ngân mặc định =====
  let {w,d}=await session('lan','2222');
  ok(tabs(d)==='Đơn hàng,Khách hàng,Cài đặt','thu ngân mặc định: tab '+tabs(d));
  ok(!!d.querySelector('.newbtn'),'thu ngân có nút Tạo đơn');
  ok(q(d,'.layoutbar button').length===3,'thu ngân có 3 kiểu hiển thị (có quyền gán)');
  nav(w,d,'settings'); await sleep(50);
  const rows=q(d,'.setrow').map(r=>r.querySelector('b').textContent);
  ok(rows.join('|').includes('Danh mục món')&&!rows.some(x=>/Nhân viên|Nhập khách|Thông tin cửa hàng/.test(x)),'cài đặt thu ngân chỉ có Danh mục món: '+rows.join('|'));
  fake(w,d,'sub-staff'); fake(w,d,'imp-open'); fake(w,d,'shop-form'); fake(w,d,'bogus-action'); await sleep(60);
  ok(d.getElementById('sheet').hidden&&!d.querySelector('.rowi[data-act=edit-staff]'),'thu ngân không mở được Nhân viên/Nhập khách/Cửa hàng/hành động lạ');
  nav(w,d,'orders'); await sleep(30);
  click(w,d.querySelector('.ticket')); await sleep(60);
  ok(!d.getElementById('sheet').hidden,'thu ngân mở được form sửa đơn');
  ok(!d.querySelector('[data-act=del][data-col=orders]'),'thu ngân mặc định không có nút Xoá đơn');
  ok(!!d.getElementById('f_ship'),'form đơn có chọn shipper (có quyền gán)');
  fake(w,d,'del',{col:'orders',id:'o1'}); fake(w,d,'del',{col:'orders',id:'o1'}); await sleep(80);
  ok(!!data.orders.o1,'gọi thẳng del đơn bị chặn, dữ liệu còn nguyên');
  w.close();

  // ===== 2. Thu ngân bỏ quyền xem tất cả đơn =====
  setPerms('c1',{'order.all':false});
  ({w,d}=await session('lan','2222'));
  ok(q(d,'.layoutbar').length===0,'bỏ "Xem tất cả đơn" thì mất luôn Tổng quan/Phân shipper (quyền con tự tắt)');
  ok(!d.querySelector('[data-act=day]'),'không đổi ngày được');
  ok(q(d,'.ticket').length===0,'thu ngân bị hạn chế chỉ thấy đơn được gán cho mình (không có đơn nào)');
  ok(!!d.querySelector('.newbtn'),'vẫn tạo đơn được (quyền riêng)');
  w.close();

  // ===== 3. Thu ngân bỏ quyền xem khách =====
  setPerms('c1',{'cust.view':false});
  ({w,d}=await session('lan','2222'));
  ok(tabs(d)==='Đơn hàng,Cài đặt','bỏ quyền xem khách: ẩn tab Khách hàng ('+tabs(d)+')');
  fake(w,d,'new-cust'); fake(w,d,'edit-cust',{id:'x'}); await sleep(50);
  ok(d.getElementById('sheet').hidden,'không mở được form khách (cust.edit phụ thuộc cust.view)');
  w.close();

  // ===== 4. Không có quyền món =====
  setPerms('c1',{'menu.edit':false});
  ({w,d}=await session('lan','2222'));
  nav(w,d,'settings'); await sleep(40);
  ok(!q(d,'.sectionlabel').some(x=>/Cửa hàng/.test(x.textContent)),'bỏ quyền món: Cài đặt không còn phần Cửa hàng');
  fake(w,d,'sub-menu'); fake(w,d,'save-menu',{id:''}); await sleep(40);
  ok(!d.querySelector('[data-act=new-menu]'),'không vào được Danh mục món');
  w.close();

  // ===== 5. Cấp thêm quyền: xoá đơn + nhập khách + sửa cửa hàng =====
  setPerms('c1',{'order.delete':true,'cust.import':true,'shop.edit':true});
  ({w,d}=await session('lan','2222'));
  nav(w,d,'settings'); await sleep(40);
  const rows5=q(d,'.setrow').map(r=>r.querySelector('b').textContent).join('|');
  ok(/Nhập khách/.test(rows5)&&/Thông tin cửa hàng/.test(rows5)&&!/Nhân viên/.test(rows5),'được cấp thêm: có Nhập khách + Thông tin cửa hàng, vẫn không có Nhân viên: '+rows5);
  nav(w,d,'orders'); await sleep(30);
  click(w,d.querySelector('.ticket')); await sleep(60);
  const delBtn=d.querySelector('[data-act=del][data-col=orders]');
  ok(!!delBtn,'được cấp quyền: có nút Xoá đơn');
  click(w,delBtn); await sleep(30); click(w,d.querySelector('[data-act=del][data-col=orders]')); await sleep(100);
  ok(!data.orders.o1,'xoá đơn thành công khi có quyền');
  w.close();

  // ===== 6. Shipper được cấp quyền thu tiền, giao =====
  data.orders.o1={date:TODAY,time:'07:00',mode:'giao',name:'Khách A',phone:'0900000001',address:'Đường 1',items:[{menuId:'m1',name:'Cơm gà',price:45000,qty:2,note:''}],total:90000,payment:'unpaid',delivered:false,createdAt:1,shipperId:'sh1'};
  setPerms('sh1',{'order.pay':true,'order.print':true});
  ({w,d}=await session('tuan','3333'));
  ok(q(d,'.ticket h3').length===1,'shipper vẫn chỉ thấy đơn của mình');
  ok(!!d.querySelector('[data-act=pay][data-v=cash]')&&!!d.querySelector('[data-act=deliver]'),'shipper được cấp quyền: có nút Tiền mặt / Đã giao');
  ok(!d.querySelector('.ticket[data-act]'),'nhưng vẫn không bấm sửa đơn được');
  click(w,d.querySelector('[data-act=pay][data-v=cash]')); await sleep(80);
  click(w,d.querySelector('[data-act=deliver]')); await sleep(80);
  ok(data.orders.o1.payment==='cash'&&data.orders.o1.delivered===true,'shipper ghi được thu tiền + đã giao');
  fake(w,d,'new-order'); fake(w,d,'del',{col:'orders',id:'o1'}); await sleep(50);
  ok(d.getElementById('sheet').hidden&&!!data.orders.o1,'shipper vẫn không tạo/xoá được');
  w.close();

  // ===== 7. Giá trị quyền bị sửa bậy bị bỏ qua =====
  setPerms('c1',{'order.print':'false','order.all':0,'report.view':'true'});
  ({w,d}=await session('lan','2222'));
  ok(tabs(d)==='Đơn hàng,Khách hàng,Cài đặt'&&q(d,'.layoutbar button').length===3,'giá trị không phải true/false bị bỏ qua, giữ mặc định');
  w.close(); setPerms('c1',undefined); setPerms('sh1',undefined);

  // ===== 8. Form phân quyền của quản lý =====
  ({w,d}=await session('admin','1111'));
  nav(w,d,'settings'); await sleep(40);
  ok(q(d,'.setrow b').some(b=>b.textContent==='Nhân viên và phân quyền'),'quản lý thấy "Nhân viên và phân quyền"');
  fake(w,d,'sub-staff'); await sleep(40);
  click(w,d.querySelector('[data-act=edit-staff][data-id=c1]')); await sleep(60);
  const boxes=()=>q(d,'#permBody [data-perm]');
  const get=k=>d.querySelector('#permBody [data-perm="'+k+'"]');
  ok(boxes().length===15,'form có 15 quyền: '+boxes().length);
  ok(get('order.create').checked&&get('order.assign').checked&&!get('order.delete').checked&&!get('report.view').checked,'thu ngân: tick đúng theo mặc định');
  const tog=(k,v)=>{const e=get(k); e.checked=v; e.dispatchEvent(new w.Event('change',{bubbles:true}))};
  tog('order.all',false);
  ok(!get('order.assign').checked,'bỏ "Xem tất cả đơn" thì "Tổng quan và gán shipper" tự bỏ');
  tog('cust.view',false);
  ok(!get('cust.edit').checked,'bỏ xem khách thì bỏ luôn sửa khách');
  tog('cust.delete',true);
  ok(get('cust.edit').checked&&get('cust.view').checked,'tick "Xoá khách" thì tự tick sửa + xem khách');
  click(w,d.getElementById('permReset')); await sleep(30);
  ok(get('order.all').checked&&get('order.assign').checked&&!get('cust.delete').checked,'nút "Về mặc định" khôi phục');
  tog('order.print',false); tog('report.view',true);
  d.getElementById('st_pw').value='';
  click(w,d.querySelector('[data-act=save-staff]')); await sleep(150);
  ok(JSON.stringify(data.staff.c1.perms)==='{"order.print":false,"report.view":true}','chỉ lưu phần khác mặc định: '+JSON.stringify(data.staff.c1.perms));
  ok(data.staff.c1.updatedBy==='Vinh','ghi người sửa: '+data.staff.c1.updatedBy);
  ok(/quyền tuỳ chỉnh/.test(d.body.textContent),'danh sách nhân viên có nhãn "quyền tuỳ chỉnh"');
  // đăng nhập lại bằng tài khoản vừa chỉnh
  w.close();
  ({w,d}=await session('lan','2222'));
  ok(tabs(d)==='Đơn hàng,Khách hàng,Báo cáo,Cài đặt','thu ngân được cấp báo cáo thấy tab Báo cáo: '+tabs(d));
  ok(!d.querySelector('[data-act=print-all]')&&!d.querySelector('[data-act=print-one]'),'bị tắt In bill: mất nút in');
  w.close();

  // ===== 9. Đổi vai trò reset quyền; quản lý không bị hạn chế =====
  ({w,d}=await session('admin','1111'));
  fake(w,d,'nav',{v:'settings'}); nav(w,d,'settings'); await sleep(30); fake(w,d,'sub-staff'); await sleep(40);
  click(w,d.querySelector('[data-act=edit-staff][data-id=c1]')); await sleep(60);
  const sel=d.getElementById('st_role'); sel.value='shipper'; sel.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(20);
  ok(q(d,'#permBody [data-perm]:checked').length===0,'đổi sang Shipper: mọi quyền về mặc định (trống)');
  click(w,d.querySelector('[data-act=save-staff]')); await sleep(150);
  ok(data.staff.c1.role==='shipper'&&Object.keys(data.staff.c1.perms||{}).length===0,'lưu Shipper không kèm quyền riêng: '+JSON.stringify(data.staff.c1.perms));
  click(w,d.querySelector('[data-act=edit-staff][data-id=a1]')); await sleep(60);
  ok(!d.querySelector('#permBody [data-perm]')&&/toàn quyền/.test(d.getElementById('permBody').textContent),'tài khoản quản lý: chỉ có ghi chú toàn quyền');
  click(w,d.querySelector('[data-act=close]')); w.close();
  data.staff.c1.role='cashier';

  // ===== 10. Chính sách mật khẩu + nâng cấp hash =====
  ({w,d}=await session('admin','1111'));
  nav(w,d,'settings'); await sleep(30); fake(w,d,'sub-staff'); await sleep(40);
  click(w,d.querySelector('[data-act=new-staff]')); await sleep(60);
  const fill=(n,u,p)=>{d.getElementById('st_name').value=n;d.getElementById('st_user').value=u;d.getElementById('st_pw').value=p};
  for(const bad of ['abc','12345','123456','111111','Password']){
    fill('Test','test1',bad); click(w,d.querySelector('[data-act=save-staff]')); await sleep(80);
    ok(!Object.values(data.staff).some(x=>x.username==='test1'),'từ chối mật khẩu yếu "'+bad+'"');
  }
  fill('Test','test1','bep9876'); click(w,d.querySelector('[data-act=save-staff]')); await sleep(400);
  const tst=Object.values(data.staff).find(x=>x.username==='test1');
  ok(tst&&tst.role&&H.passwords['test1']==='bep9876','tài khoản mới tạo qua hàm máy chủ với mật khẩu đã đặt');
  w.close();
  ({w,d}=await session('test1','bep9876'));
  ok(!!d.querySelector('.top'),'đăng nhập được bằng mật khẩu hash mới');
  w.close();
  ({w,d}=await session('binh','4444'));
  await sleep(500);
  w.close();
  ({w,d}=await session('binh','4444'));
  ok(!!d.querySelector('.top'),'đăng nhập lại sau nâng cấp vẫn được');
  w.close();
  ({w,d}=await session('lan','2222'));
  // đổi mật khẩu
  nav(w,d,'settings'); await sleep(30); fake(w,d,'change-pw'); await sleep(40);
  const setpw=(c,a,b)=>{d.getElementById('p_cur').value=c;d.getElementById('p_new').value=a;d.getElementById('p_new2').value=b};
  setpw('2222','123456','123456'); click(w,d.querySelector('[data-act=save-pw]')); await sleep(300);
  ok(!d.getElementById('sheet').hidden,'đổi sang 123456 bị từ chối');
  setpw('2222','bepmoi77','bepmoi77'); click(w,d.querySelector('[data-act=save-pw]')); await sleep(500);
  ok(d.getElementById('sheet').hidden,'đổi sang mật khẩu tốt được');
  w.close();
  ({w,d}=await session('lan','bepmoi77'));
  ok(!!d.querySelector('.top'),'đăng nhập bằng mật khẩu mới');
  w.close();

  // ===== 11. Khoá đăng nhập khi sai nhiều lần =====
  ({w,d}=await openApp());
  for(let i=0;i<5;i++) await loginAs(w,d,'tuan','sai-roi',250);
  ok(/khoá|Nhập sai nhiều/.test(d.getElementById('authErr').textContent),'sai 5 lần thì bị tạm khoá: '+d.getElementById('authErr').textContent);
  await loginAs(w,d,'tuan','3333',250);
  ok(!d.querySelector('.top'),'trong lúc bị khoá, nhập đúng cũng chưa vào được');
  w.close();
  ({w,d}=await openApp());
  await loginAs(w,d,'tuan','sai',250);
  ok(/Còn 4 lần/.test(d.getElementById('authErr').textContent),'báo số lần thử còn lại: '+d.getElementById('authErr').textContent);
  w.close();

  // ===== 12. Thu ngân không có quyền gán thì không đổi được shipper qua form đơn =====
  data.orders.o1.delivered=false; data.orders.o1.shipperId='sh1'; data.orders.o1.shipperName='Tuan';
  setPerms('c1',{'order.assign':false});
  data.staff.c1.role='cashier';
  ({w,d}=await session('lan','bepmoi77'));
  ok(q(d,'.layoutbar').length===0,'thu ngân không có quyền gán: không có kiểu hiển thị gán shipper');
  click(w,d.querySelector('.ticket')); await sleep(60);
  ok(!d.getElementById('f_ship'),'form đơn không có ô chọn shipper');
  click(w,d.querySelector('[data-act=save-order]')); await sleep(150);
  ok(data.orders.o1.shipperId==='sh1','sửa đơn xong shipper vẫn giữ nguyên: '+data.orders.o1.shipperId);
  w.close();
  finish();
})().catch(e=>{console.error(e);process.exit(2)});
