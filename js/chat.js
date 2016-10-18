		var discon = false;
		var myname = false;
		var global_input_height = false;
		var user_list_width = false;
		var users;
		
		
		//var notif = notification();
		//
		//if (/*@cc_on!@*/false) { // check for Internet Explorer
		//	document.onfocusin = onFocus;
		//	document.onfocusout = onBlur;
		//} else {
		//	window.onfocus = onFocus;
		//	window.onblur = onBlur;
		//}
		
		$(document).ready(function(){
			var socket = io();
				global_input_height = $('#global-input').height();
				user_list_width = $('#user-list').width();
			var users_list = $('#user-list').children().children();
		 
			if (!myname){ // если имя пустое (false по-умолчанию), то выдается это сообщение
				systemMessage('notification','Чтобы войти в чат, введите Ваш ник (в одно слово)');
			}
			
			$('form').submit(function () {
				/* Отправка сообщения от клиента на сервер.
				* Если пользователь первый раз подключился к серверу, то ему предлагается
				* ввести его имя на сервере.
				* 
				* Все сообщения пользователя не принимаются с сервера, а добавляются оффлайн
				* Сообщение не отправится, если поле ввода было пустым.
				* Нельзя отправлять сообщение длинной более 500 символов
				* 
				* Если при этом у пользователя не указан его ник, то считается, что сообщение первое.
				* В таком случае сообщение рассматривается как ник. Ник строится по условию:
				* Только одно слово (без пробелов), не длиннее 16 символов.
				* 
				*/
				
				global_input_height = $('#global-input').height();
				user_list_width = $('#user-list').width();
				
				msg = $('#m').val().slice(0,500);;
				
				if (msg!=''){
					if (!myname){
						myname = msg.split(' ',1)[0].slice(0,16);
						socket.emit('chat message', myname);
						systemMessage('notification','Теперь Ваш ник - ' + myname);
					} else {
						socket.emit('chat message', msg);
						chatMessage(myname, msg);
					}
						$('#m').val('');
				} else {
					systemMessage('critical','Вы забыли ввести сообщение.');
				}
				return false;
			});
			
			socket.on('connect', function (msg) {
				/* Реакция на подключение к серверу.
				* В случае, если пользователь не был причастен к отключению от сервера,
				* выводится сообщение о успешном восстановлении подключения.
				* 
				*/
				if (discon) {
					systemMessage('accept','Связь с сервером восстановлена!');
					discon = false;
					if (myname){
						socket.emit('chat message', myname);
						systemMessage('notification','Ваш ник "' + myname + '" восстановлен!');
					}
				}
			});
			
			socket.on('chat message', function (msg) {
				/* Принимает сообщения для глобального чата.
				 * Сообщение msg является объектом, где:
				 * 	username - имя пользователя, которым он представился;
				 * 	text - текст сообщения от пользователя
				 * 
				 */
				
				notif(); // уведомление о сообщении пользователя
				chatMessage(msg.username,msg.text);
			});
			
			socket.on('system message', function (msg) {
				/* Выводит уведомление, полученное с сервера.
				 * 
				 */
				systemMessage('notification',msg);
			});
			
			socket.on('critical message', function (msg) {
				/* Выводит критическое сообщение, полученное с сервера.
				 * 
				 */
				systemMessage('critical',msg);
			});
			
			socket.on('disconnect', function (msg) {
				/* Выводит сообщение о разрыве связи с сервером.
				 * 
				 */
				systemMessage('critical','Отключен от сервера.');
				discon = true;
				//myname = false;
			});
			
			socket.on('user list', function (msg) {
				/* Обновляет список активных пользователей.
				 * 
				 * TODO: сделать не циклом-костылем
				 * 
				 */
				//users_list.eq(0) // шапка в окне пользователей
				for (var i=1; i<users_list.length; i++){
					users_list.eq(i).remove();
				}
				for (var i=0; i<msg.length; i++){
					users_list.after($('<li>').text(msg[i]));
				}
				
				users_list = $('#user-list').children().children();
			});
			
			socket.on('last messages', function (msg) {
				/* Получает сообщения, которые были написаны до того,
				 * как подключился пользователь.
				 * 
				 */
				
				for (var i = msg.length-1; i>=0; i--){
					chatMessage(msg[i].nick,
								msg[i].msg,
								msg[i].time);
				}
				 
				 
			});
			
			/*$(window).resize( function () {
				/* Функция следит за тем, чтобы при изменениях размера окна браузера
				 * блоки были растянуты на всё пространство.
				 * 
				 * Высота блока для ввода сообщения принята за 50px.
				 * 
				 *
			
				fullScreen();
				chatScroll();
			});*/
			
			//fullScreen();
			
			
		//END $(document).ready(function())
		});
		 
		function systemMessage(type, msg){
			/* Функция вставки системных сообщений.
			 * Имеют сплошную заливку.
			 * Вид: [ВРЕМЯ] СООБЩЕНИЕ
			 * 
			 * Возможные значения параметра type:
			 * critical - сообщение об ошибке
			 * accept - сообщение об успешном выполнении действия
			 * notification - любое другое уведомление.
			 * 
			 */
			msg = '[' + getTime() + '] ' + msg;
			$('#messages').append($('<li>').text(msg).addClass('system '+type));
			
			chatScroll();
		}
		
		//$(window).resize( function () { $('#main-div').children().height($(window).height()-40); });
		 
		function chatMessage(user, msg, time){
			/* Функция вставки сообщений от пользователей.
			 * 
			 * Вид: [ВРЕМЯ] ИМЯ_ПОЛЬЗОВАТЕЛЯ: СООБЩЕНИЕ
			 * 
			 * Если в функцию не был передан параметр time, то автоматически
			 * ставится текущее время сообщения.
			 * 
			 */
			 
			 /*
			if (time === undefined){
				time = getTime();
			}*/
						
			var infoField = '[' + getTime(time) + '] ' + user + ': ';
			//$('#messages').append($('<li>').append($('<span>').addClass('infoField').text('[' + getTime() + ' | ' + user + '] ')).text(msg));
			$('#messages').append($('<li>')
			.append($('<span>').text(infoField).addClass('time'))
			.append($('<span>').text(msg)));
			
			chatScroll();
		}
		 
		function getTime(time){
			/* Функция просто возвращает время в одном формате для всех сообщений.
			 * 
			 */
			return moment(time).format('DD-MM-YYYY HH:mm:ss');
		}
		
		function fullScreen(){
			/* Изменяет параметры блоков для корректного растягивания их на весь экран.
			 * 
			 * TODO: запилить поддержку телефонов.
			 * 
			 */
			
			var h=$(window).height() - global_input_height;
			var w=$(window).width() - user_list_width;
			$('#chat-div').height(h).width(w);//.scrollTop(h);
			$('#user-list').height(h)
			
		}
		
		function chatScroll(){
			/* Необходимо для прокрутки блока чата до конца.
			 * Используется при изменении размера браузера или при получении нового сообщения.
			 * 
			 */
			
			var temp_cd = $('#chat-div').children()
			var chatScrollTop = $('#messages').height()-temp_cd.height();
			if (chatScrollTop > 0) {
				temp_cd.scrollTop(chatScrollTop);
			}
		}
		
		function notif(){
			/* Занимается уведомлениями.
			 * 
			 */
			
			$('#notification-sound')[0].play();
		}
