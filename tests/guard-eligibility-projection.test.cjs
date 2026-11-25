const test=require('node:test')
const assert=require('node:assert/strict')
const {visibleStateForUser,authorizeIncomingState}=require('../api/_lib/core.cjs')

function fixture(){
 return {roles:[{id:'tech',code:'technician',name:'Técnico'}],employees:[{id:'new',roleId:'tech',role:'Técnico',status:'Activo',firstName:'Santiago',lastName:'Castillo',name:'Santiago Castillo',technicalEnabled:false,canReceiveCash:false,employmentStartDate:'2026-11-25',email:'private@example.test',passwordHash:'private-hash'}],customers:[],services:[],vehicles:[],history:[],reviews:[],preferences:{},agenda:{date:'2026-11-25',teams:[],weekly:{}}}
}
const actor={id:'planner',roleId:'planner',roleCode:'custom',permissions:{__catalogV2:true,'weekly.view':true,'records.read':true,'planning.technicians':true,'weekly.guards.read':true}}

test('la planificación recibe habilitación de guardias sin exponer fecha de ingreso ni credenciales',()=>{
 const state=fixture(),visible=visibleStateForUser(state,actor)
 assert.equal(visible.employees[0].guardEligibleFrom,'2027-01-24')
 for(const field of ['employmentStartDate','email','passwordHash'])assert.equal(visible.employees[0][field],undefined)
 const authorized=authorizeIncomingState(visible,state,actor)
 assert.deepEqual(authorized.employees,state.employees)
 visible.employees[0].guardEligibleFrom='2020-01-01'
 const forged=authorizeIncomingState(visible,state,actor)
 assert.deepEqual(forged.employees,state.employees,'La fecha derivada no permite eludir la espera ni modificar al empleado')
})

test('administración conserva la fecha real para editar el ingreso',()=>{
 const employee=visibleStateForUser(fixture(),{roleCode:'administrator'}).employees[0]
 assert.equal(employee.employmentStartDate,'2026-11-25')
 assert.equal(employee.passwordHash,undefined)
})
