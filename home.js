var express = require('express'),
    http = require('http'),
    app = express(),
    server = http.createServer(app),
    bodyParser = require('body-parser'),	
    lirc_node = require('lirc_node'),
    GPIO = require('onoff').Gpio,
    plug = new GPIO(2, 'high'),
    touch = new GPIO(26, 'in', 'rising'),
    gcm = require('node-gcm'),
    winston = require('winston'),
    mysql = require('mysql');

require('date-utils');

var logger = new(winston.Logger)({
    transports:[
        new (winston.transports.Console)({
        timestamp:function(){return new Date().toFormat('YYYY-MM-DD HH24:MI:SS')}    
        })
    ]
});

var serverKey = 'AAAAusk2Pec:APA91bFlmFJj_CkY8MRhmd2hHPVWoFiAcpRY7DmaohQZmh3b6oB-dSW2hEpjCpmgSnjOKj1SfU-8GOWyemcUZ5e8bgpNCsIYKMuH_O_2HXFoPIb16ub-4Iu_NXnaxmCryK7KcbmMm1bC';
var sender = new gcm.Sender(serverKey);

var isHolding = false;

function l(log) {
    //console.log(log);
    logger.info(log);
}

function e(log) {
    logger.error(log);
}

function holdToggle() {
    isHolding = true;
}

function releaseToggle() {
    isHolding = false;
}

function toggling() {

    if(isHolding) {
        l("holding!!");
        return;
    }
    
    holdToggle();
    setTimeout(releaseToggle, 500);

    if(plug.readSync() == 1) {
        plug.writeSync(0);
        l("plug on");
    }
    else {
        plug.writeSync(1);
        l("plug off");
    }
    sendPush();
}

function responsePlugStat(res) {
    l("response plug stat : " + plug.readSync());
    if(plug.readSync() == 1) {
        res.send([{result:'off'}]);
    }
    else {
        res.send([{result:'on'}]);
    }
}

touch.watch(function (err, value) {
    if(err) {
        throw err;
    }
    
    l("touching");
    toggling();
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended : false }));

app.get('/plug', function(req, res){
    res.sendFile('/html/plug.html', {root : __dirname });
});

app.post('/plugdata', function(req, res){
	var state = req.body.switch;
	if (state == 'ON') {
		plug.writeSync(0);
	}
	else {
		plug.writeSync(1);
	}
	l('plug ' + state);
	res.sendFile('/html/plug.html', {root : __dirname });
});

app.get('/plugon', function(req, res) {
	plug.writeSync(0);
	res.send([{result:'ok'}]);
    l('plug ' + plug.readSync());
});

app.get('/plugoff', function(req, res) {
	plug.writeSync(1);
	res.send([{result:'ok'}]);
    l('plug ' + plug.readSync());
});

app.get('/plugtoggle', function(req, res) {

    toggling();
    responsePlugStat(res);
});

app.get('/plugstat', function(req, res) {
    
    responsePlugStat(res);
});

app.get('/regclient', function(req, res) {
    
    regid = req.query.regid;
    l("Recv regid : " + regid);
    
    pool.getConnection(function(err,connection) {
        var data = [req.query.user, req.query.regid];
        var query = connection.query('REPLACE INTO MYHOME.PUSH_INFO VALUES (?,?)'
                , data
                , function(err, result) {
                    if(err) {
                        e(err);
                        connection.release();
                        return;
                    }
            l("Successfully inserted");
            connection.release();
        });
    });
    responsePlugStat(res);
});

function sendPush() {
    pool.getConnection(function(err,connection) {
        var onoff = 'on';
        if(plug.readSync() == 1)
            onoff = 'off';
        var message = new gcm.Message({
                        collapse_key:'plug state',
                        data:{state:onoff}
                    });
        var query = connection.query('SELECT * FROM MYHOME.PUSH_INFO'
                , function(err, rows) {
                    if(err) {
                        e(err);
                        connection.release();
                        return;
                    }
                    var registrationIds = [];
                    for(var i=0; i<rows.length; i++) {
                        registrationIds.push(rows[i].REG_ID);
                    }
                    sender.send(message, registrationIds, 3, function(err, result) {
                        l(result);
                    });
                    connection.release();
                });
    });
}

var pool = mysql.createPool({
    host:'localhost',
    port:3306,
    user:'viewise',
    password:'P@ssw0rd',
    database:'MYHOME'
});







var hold = false;

function holdListen() {
    hold = true;
}
function releaseListen() {
    hold = false;
}

lirc_node.init();

lirc_node.addListener(function(data){
    l("Recv " + data.remote + " " + data.key);
    
    if(data.remote == 'BN59-01198P') {
        if(data.key == 'POWER')
            sendSignal('AH59-01778Q', data.key, null, 3);
        else {
            if(hold == true){
                l('holdListen!');
                return;
            }
            holdListen();
            setTimeout(releaseListen, 300);
            sendSignal2('AH59-01778Q', data.key, null, 300);
        }
    }
});

app.get('/remote', function(req, res){
    res.sendFile('/html/remote.html', {root : __dirname });
});

var sendSignal = function(name, sig, res, cnt){
    for(var i=0; i<cnt; i++){
        lirc_node.irsend.send_once(name, sig);
    }
	lirc_node.irsend.send_once(name, sig);

    l("Sent " + name + " " + sig + " " + (cnt+1));

    


    //only test
    sendPush();
    
    
    
    
    if(res != null)
	    res.send([{result:'ok'}]);
};

var stopSignal = function() {
    lirc_node.irsend.send_stop();
}
var sendSignal2 = function(name, sig, res, msec){
    lirc_node.irsend.send_start(name, sig);
    l("Sent for " + msec + "msec");
    setTimeout(stopSignal, msec);
}

app.get('/remotepower', function(req, res){
    sendSignal('dm-2901', 'POWER', res, 1);
});

app.get('/remotemute', function(req, res){
    sendSignal('dm-2901', 'MUTE', res, 1);
});

app.get('/remotechup', function(req, res){
    sendSignal('dm-2901', 'CHANNELUP', res, 1);
});

app.get('/remotechdn', function(req, res){
    sendSignal('dm-2901', 'CHANNELDOWN', res, 1);
});

app.get('/remotevlup', function(req, res){
    sendSignal('dm-2901', 'VOLUMEUP', res, 20);
});

app.get('/remotevldn', function(req, res){
    sendSignal('dm-2901', 'VOLUMEDOWN', res, 20);
});

app.post('/remotedata', function(req, res){
    var state = req.body.dm;

    sendSignal('dm-2901', state, null, 1);
    
    res.sendFile('/html/remote.html', {root : __dirname });
});
	
server.listen(9431, function() {
    l('Express server listenling on port ' + server.address().port) ;
});
