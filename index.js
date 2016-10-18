var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var moment = require('moment');

var mysql = require('mysql');
var mysqlu = require('mysql-utilities');
var mysqlinfo;

// Для защиты данные подцепляются из внешнего файла JSON
// Если файл не создан, то информация о БД сохраняется из catch()
// Проверки файла нет, структура у него должна быть такая же,
// как в объекте в catch(). Если структура не верна, коннекшон
// не пройдет.
try {
	mysqlinfo = require('./mysql.json');
} catch(e) {
	mysqlinfo = {
		connectionLimit : 3,
		host:     'localhost',
		user:     'userName',
		password: 'secret',
		database: 'databaseName'
	}
}

//var connection = mysql.createConnection(mysqlinfo);
var pool  = mysql.createPool(mysqlinfo);

// порт для прослушки адреса в http запросе
// process.env.PORT -- for Bluemix
var httport = process.env.PORT || 1337;
// Массив юзеров в вакууме (ID + никнейм)
// Содержит структуру:
// {
//   socket.id : username,
//   ...
// },
// где socket.id - уникальный ID, выдающийся Socket.io,
// username - уникальное имя пользователя, которое он вводит при входе.
var users = new Object();
// Массив юзеров в вакууме (ID + никнейм)
// Содержит структуру:
// {
//   username : socket.id,
//   ...
// },
// где socket.id - уникальный ID, выдающийся Socket.io,
// username - уникальное имя пользователя, которое он вводит при входе.
// Дублирование данных в объекте необходимо для быстрого поиска одного и другого.
var userNames = new Object();
// А это вообще тупо массив, который кастуется и отправляется пользователю
// только при первом входе этого пользователя для получения списка участников.
var unarr = [];
// Массив забаненных пользователей по IP
// Содержит структуру:
// {
//   socket.request.connection.remoteAddress : bool,
//   ...
// },
// где bool = true, если IP был забанен
var blackList = new Object();


/* НА БУДУЮЩЕЕ *\

Перебор элементов обжекта в жаваскрипте -- это уже перебор. Ну, точнее хардкор.
В любом норм языке получение названия поля класса -- не освсем нормальное занятие.
Но тут это норм, т.к. Обжект(R)(TM) == массив с парой ключ:значение.
Вообще, можно было и несколько тупых массивов иметь, а не складывать ключи со значениями.
Но тут скорость и удобство поиска по обжекту столь высоко, что на память мы забиваем.

Работать с таким обжектсивом можно с помощью следующего подобия foreach:

for (var field in object){
	object[field]; -- выдает содержимое поля (обычный перебор)
	field; -- выдает тупо название поля (вот это переворот!)
}

То есть да, этот форич в переменной field возвращает не содержимое поля объекто,
а непосредственно название этого поля. JavaScript познавательный.

*/

app.use('/style', express.static(__dirname + '/style')); // открытый доступ к разделу /style
app.use('/sound', express.static(__dirname + '/sound')); // открытый доступ к разделу /sound
//app.use('/socket.io', express.static(__dirname + '/node_modules/socket.io-client')); // открытый доступ к либе socket.io
app.use('/js', express.static(__dirname + '/js')); // открытый доступ к разделу библиотек, загружаемых не через npm
app.use('/js/moment', express.static(__dirname + '/node_modules/moment')); // открытый доступ к библиотеке moments.js

app.get('/', function (req, res) {
	res.send('<h1 style="height:100%;color:red;text-align:center;">Нello Шorld!</br><a href="/chat">УЛИЦА РОЩИ</a></h1>');
});

app.get('/chat', function (req, res) {
	res.sendFile(__dirname + '/chat.htm');
});

io.on('connection', function (socket) {
	console.log('['+moment().format() + '] connected user ' + socket.id + " (" + socket.request.connection.remoteAddress + ")");
	
	if (isBanned(socket.request.connection.remoteAddress) ){
		sendAlert(socket, 'Вы были забанены в этом чате ');
	}
	
	if (users[socket.id] === undefined){
		sendSys(io.to('global'), 'К чату присоеденился анон.');
		//sendMe(socket,createMsg('SERVER MESSAGE','Анон! Мы всё еще ждем, когда ты скажешь, как тебя зовут'));
	}
	
	socket.on('disconnect', function () {
		/* Определяет отключение пользователя от сервера.
		 * 
		 * Если пользователь вошел в чат (указал ник), то его ник удаляется с сервера, его
		 * выгоняют из группы, а система пишет в уведомлении для пользователей ник ушедшего.
		 * Если пользователь не был добавлен, то система только уведомляет о выходе анона из чата.
		 * 
		 */
		console.log('['+moment().format() + '] disconnect user ' + socket.id + " (" + socket.request.connection.remoteAddress + ")");
		
		if (users[socket.id]!=undefined){
			socket.leave('global');
			sendSys(io.to('global'),'Ублюдок "' + users[socket.id] + '" покинул нас');
			
			delete userNames[users[socket.id]];
			delete users[socket.id];
					
			sendUsers(io.to('global')); //отправляет целиком массив пользователей всем пользователям
		}
		else {
			sendSys(io.to('global'),'Анон не смог...');
		}
		
	});
	socket.on('chat message', function (msg) {
		/* Отправляет сообщения глобального чата.
		 * Сообщение msg является объектом, где:
		 * 	username - имя пользователя, которым он представился;
		 * 	text - текст сообщения от пользователя
		 * 
		 * Нельзя отправлять сообщение длинной более 500 символов
		 * 
		 * Отправка не срабатывает, если пользователь отправил пустое сообщение.
		 * Если сообщение является первым от пользователя, то первое слово сообщения становится его ником.
		 * Ник состоит из одного слова, длинной не более 16 символов.
		 * 
		 */
		
		if (msg != '') {
			msg.slice(0,500);
			if (users[socket.id] === undefined){
				var name = msg.split(' ',1)[0].slice(0,16);
				if (userNames[name] === undefined){
					
					users[socket.id] = name;
					userNames[name] = socket.id;
					
					sendSys(io.to('global'), '  Паперветствуем нового чувака "'+name+'"!');
					getLastMessagesFromBD(socket);
					socket.join('global');
					
					/* Так типа как бы лучше, чем как есть. Но так пилить долго...
					sendUsers(socket);
					sendUsers(io.to('global'), name);
					*/
					
					sendUsers(io.to('global')); //отправляет целиком массив пользователей всем пользователям
				} else {
					sendAlert(socket, ' Сорян, чувакэ, но имя "'+name+'" уже занято...');
				}
			} else {
				sendAll(socket,createMsg(users[socket.id],msg));
				saveMessageToBD(users[socket.id],msg,socket.request.connection.remoteAddress);
			}
		}
	});
});

function sendSys(s,text){
	/* Функция для отправки системного сообщения.
	 * Если передать в 's' объект 'io', то системное сообщение отправляется всем пользователям,
	 * если передать в 's' объект 'socket', то системное сообщение отправляется только лично пользователю,
	 */
	s.emit('system message',text);
}

function sendAlert(s,text){
	/* Функция для отправки системного сообщения уровня critical.
	 * Если передать в 's' объект 'io', то системное сообщение отправляется всем пользователям,
	 * если передать в 's' объект 'socket', то системное сообщение отправляется только лично пользователю,
	 */
	s.emit('critical message',text);
}

function sendMe(s,text){
	/* Функция для отправки сообщения только пользователю лично, но при этом не системная.
	 * Удобно использовать для отправки личных сообщений в чат от лица системы (например, приветствие).
	 * s - должен быть только socket.
	 */
	s.emit('chat message',text);
}

function sendUsers(s,username){
	/* Функция для отправки сообщения только пользователю лично, но при этом не системная.
	 * Удобно использовать для отправки личных сообщений в чат от лица системы (например, приветствие).
	 * s - должен быть только socket.
	 */
	if (username === undefined){
		for (var i in userNames){
			unarr.push(i);
		}
		s.emit('user list',unarr);
		unarr = [];
	} else {
		s.emit('user list',username);
	}
}

function sendAll(s,text){
	/* Функция для отправки сообщения для всех, кроме пользователя.
	 * Типичная функция чата.
	 * s - должен быть только socket.
	 */
	s.broadcast.to('global').emit('chat message',text);
}

function createMsg(user, msg){
	/* Создание сообщения для чата с следующим содержанием:
	 * 	username - имя пользователя, которым он представился;
	 * 	text - текст сообщения от пользователя
	 * 
	 */
	return msg = {username:user,text:msg};
}

function isBanned(ip){
	/* Проверяет наличие ip в списках бана.
	 * Возвращает true, если ip числится в списке;
	 * добавляет ip в список, если пользователь не найден, и возвращает false.
	 * 
	 */
	if (blackList[ip] === undefined) {
		blackList[ip] = false;
		return false;
	}
	return blackList[ip];
}

function saveMessageToBD(nick,msg,ip){
	/* Сохраняет каждое сообщение пользователей в БД.
	 * 
	 */
	pool.getConnection(function(err, connection){
		connection.query("INSERT INTO `ad_3e3806afa571fe4`.`global_messages` (`nick`, `msg`, `ip`, `time`) VALUES ('"+nick+"', '"+msg+"', '"+ip+"', NOW());", function(err, rows){
			if(err) throw err;
			else {
				console.log(rows);
			}
		});
		
		connection.release();//release the connection
	});
}

function getLastMessagesFromBD(s){
	/* Вытаскивает из БД 10 последних сообщений.
	 * 
	 * Ввиду того, что JS нереально распараллелен, эта функция сама отправляет
	 * все данные клиенту (пачкой)
	 * 
	 */
	pool.getConnection(function(err, connection){
		connection.query('select * from ad_3e3806afa571fe4.global_messages ORDER BY id DESC LIMIT 10', function(err, rows){
			if(err) throw err;
			else {
				s.emit('last messages',rows);
			}
		});
		
		connection.release();//release the connection
	});
	console.log('TESTESTESTETSETSETSETSETSETSETSETSETSETSETSETSETSETSETEST');
}

//LOAD SERVER
http.listen(httport, function () {
	//var conuser = connection.config.user+'@'+connection.config.host;
	var conuser = pool.config.user+'@'+pool.config.host;
	
	/*
	console.log('listening on *:' + httport);
	
	
	pool.getConnection(function(err, connection){    
		//run the query
		connection.query('select * from ad_3e3806afa571fe4.global_messages ORDER BY id DESC LIMIT 10', function(err, rows){
			if(err) throw err;
			else {
				console.log(rows);
			}
		});
		
		connection.release();//release the connection
	});*/
	
		//connection.end();
	
	/*
	connection.query('SELECT 1', function(err, rows) {
		
		console.log('Ошибочка вышла '+conuser);
	});
	
		//connection.end();
		
		
	connection.query('SELECT 1', function(err, rows) {
		
		console.log('4 '+conuser);
	});
	
		connection.end();
			connection.query('SELECT 1', function(err, rows) {
		
		console.log('3 '+conuser);
	});
	
		connection.end();
			connection.query('SELECT 1', function(err, rows) {
		
		console.log('2 '+conuser);
	});
	
		connection.end();
			connection.query('SELECT 1', function(err, rows) {
		
		console.log('1 '+conuser);
	});
	
		console.log('СЫШ ЧО '+conuser);
	
		connection.end();
		
		*/
	
	/*
	pool.query('SELECT 1 + 1 AS solution', function(err, rows, fields) {
		if (err) throw err;
		console.log('The solution is: ', rows[0].solution);
	});
	
	pool.query('SELECT 1 + 1 AS solution', function(err, rows, fields) {
		if (err) throw err;
		console.log('The solution is: ', rows[0].solution);
	});
	
	pool.query('SELECT 1 + 1 AS solution', function(err, rows, fields) {
		if (err) throw err;
		console.log('The solution is: ', rows[0].solution);
	});
	*/
	
	
	
	
	
	/*
	try {
		connection.connect();
		console.log('Successful connection to '+conuser);
	} catch (e) {
		console.error("CAN'T CONNECTED TO BD "+conuser+"!!!");
		console.log(e);
	} finally {
		connection.destroy();
		console.error("Connection has been closed");
	}
	
	
	
	connection.connect(function(err) {
	if (err) {
		console.error("CAN'T CONNECTED TO BD "+conuser+"!!!"+err.stack);
		return;
	}
		
	console.log('Successful connection to '+conuser);
	});
	connection.destroy();
	console.log('Successful connection to '+conuser);
	*/
	
});