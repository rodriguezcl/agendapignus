const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {HistoryDetail}=require('./helpers/load-app.cjs')(['HistoryDetail']);
const record={id:'payment-test',date:'2026-10-13',client:'Cliente de prueba',service:'Service de cerco eléctrico',status:'Completado',amount:'85000',paymentMethod:'Efectivo',monthlyFee:'45000'};
const render=(patch={},props={})=>renderToStaticMarkup(React.createElement(HistoryDetail,{record:{...record,...patch},close:()=>{},...props}));
test('administrative service detail includes saved payment information',()=>{
 const html=render();
 assert.match(html,/Monto a abonar/);assert.match(html,/85[.,]000/);assert.match(html,/Forma de pago/);assert.match(html,/Efectivo/);assert.match(html,/Abono mensual/);assert.match(html,/45[.,]000/);
});
test('missing amounts are distinguished from an explicitly saved zero',()=>{
 assert.match(render({amount:''}),/Monto a abonar<\/b><span>Sin registrar/);
 assert.doesNotMatch(render({amount:0}),/Monto a abonar<\/b><span>Sin registrar/);
});
test('vehicle controls and restricted detail do not acquire payment fields',()=>{
 assert.doesNotMatch(render({vehicleControl:true}),/Monto a abonar|Forma de pago|Abono mensual/);
 assert.doesNotMatch(render({}, {hideInternal:true}),/Monto a abonar|Forma de pago|Abono mensual/);
});
