import { Component, Input, OnInit } from '@angular/core';
import { NavController, NavParams, AlertController } from 'ionic-angular';
import { TranslateService} from 'ng2-translate';
import { Keyboard } from 'ionic-native';

import { EncodeJSONRead } from '../../ngx-tryton-json/encode-json-read'
import { TrytonProvider } from '../../ngx-tryton-providers/tryton-provider'

// Interfaces
import { Move } from '../../ngx-tryton-stock-interface/move';
import { InternalShipment } from '../../ngx-tryton-stock-interface/shipment';

@Component({
  selector: 'page-shipments-internal-details',
  templateUrl: 'shipments-internal-details.html'
})
export class InternalShipmentsDetailsPage implements OnInit{
     @Input() itemInput: string;
    /**
     * Lines of the current Shipment
     * @type {Move[]}
     */
    shipmentLines: Move[] = [];
    /**
     * Current shipment
     * @type {Shipment}
     */
    shipment: InternalShipment;
    fields: Array<string>;
    domain: Array<any>;
    lastItem: Move;

    constructor(public navCtrl: NavController, public navParams: NavParams,
        public trytonProvider: TrytonProvider, public translateService: TranslateService,
        public alertCtrl: AlertController) {
        this.shipment = navParams.get('shipment');
        this.fields = ['product:["rec_name", "code"]', 'quantity', 'state'];
        let json_constructor = new EncodeJSONRead;
        this.domain = [json_constructor.createDomain('shipment', '=', 'stock.shipment.internal,' + this.shipment.id)];
    }

    ngOnInit() {
        this.loadShipmentLines();
    }

    ngAfterViewInit(){
        Keyboard.show();
        document.getElementById('code').focus()
        Keyboard.close()
    }

    public inputChange(event) {
        if (this.itemInput.length > 5) {
          // Wait for results
          this.searchProductCode(this.itemInput).then(
              data => {
                // console.log("Data", data)
                // Filter elements by product id
                if (!data['id']) {
                  this.clearInput();
                  return
                }
                let line = this.shipmentLines.filter(i => i['product.id'] == data['id'])[0];
                if (this.checkQuantity(line, 1)) {
                  if (this.checkReminders()) {
                    this.clearInput();
                    return this.setStage(this.shipment.state);
                  } else {
                    this.clearInput();
                  }
                } else {
                  this.lastItem = line;
                  this.clearInput();
                  return false
                }
              },
              error => {
               console.log("ERROR")
               return false
          })
        } else if (this.lastItem){
          if (this.checkQuantity(this.lastItem, Number(this.itemInput))){
            if (this.checkReminders()){
              this.setStage(this.shipment.state);
              this.lastItem = undefined;
              this.clearInput();
            }
            this.clearInput();
          }
        } else {
          alert("No previous item for given quantity")
        }
    }

    /**
     * Checks if the given quantity matches with line quantity
     * @param  {Move}    line     Line to check
     * @param  {number}  quantity Quantity to check
     * @return {boolean}          True if it matches
     */
    public checkQuantity(line: Move, quantity:number): boolean {
        if (line.quantity == quantity){
            this.shipmentLines = this.shipmentLines.filter(i => i !== line);
            return true;
        } else if (line.quantity < quantity){
            alert("Quantity entered is bigger that line quantity (WTF)");
        } else {
          if (Number.isInteger(quantity)) {
            let index = this.shipmentLines.indexOf(line);
            this.shipmentLines[index].quantity -= quantity;
          }
        }
        return false;
    }

    /**
     * Sets the next logical state for the current shipment
     * @param  {string} stateName Current state of the shipment
     */
    public setStage(stateName: string) {
        /**
         * Transitions name, first value is the name of the next state
         * second value is the name of the function
         * @type {Object}
         */
        let transitions = {
            'draft': 'waiting',
            'waiting': 'assigned',
            'assigned': 'done',
            'done': undefined
        }

        let model = undefined;
        let next_stage = transitions[stateName];
        switch (next_stage){
            case 'waiting':
                model = "model.stock.shipment.internal.wait";
                break;
            case 'assigned':
                model = "model.stock.shipment.internal.assign_try";
                break;
            case 'done':
                model = "model.stock.shipment.internal.done";
                break;
            default:
                model = undefined;
                break;
        }
        if (model){
            this.trytonProvider.rpc_call(model, [[this.shipment.id]])
            .subscribe(
                data => {
                    // Recursively call setStage until the state is done
                    this.setStage(next_stage);
                },
                error => {
                    let alert = this.alertCtrl.create({
                        title: "Error",
                        subTitle: error.messages[0],
                        buttons: ['Ok']
                    });
                    alert.present();
                }
            )
        } else {
          this.leaveView();
        }
    }
    /**
     * Shows a message before leaving
     */
    public leaveView() {
        this.translateService.get('Leaving Shipment Internal').subscribe(
            value => {
                let confirm = this.alertCtrl.create({
                    title: value,
                    message: '',
                    enableBackdropDismiss: false,
                    buttons: [{
                        text: 'OK',
                        handler: () => {
                            this.navCtrl.pop()
                            },
                        }, {
                      text: 'Cancel',
                      handler: () => {
                        return;
                      }
                    }],
                });
            confirm.present();
        });
    }

    /**
     * Searchs the rec_name of a product for a match
     * @param  {string}       code Code to match
     * @return {Promise<any>}      Id of the product if it matches
     */
    private searchProductCode(code: string): Promise<any> {
        return new Promise<number>((resolve, reject) =>{
            let json_constructor = new EncodeJSONRead;
            let product_domain = [json_constructor.createDomain('rec_name', 'ilike', '%' + code)];
            let method = "product.product";
            json_constructor.addNode(method, product_domain, ["id"]);
            let json = json_constructor.createJson();
            this.trytonProvider.search(json).subscribe(
                data => {
                    console.log("Item exisits", data);
                    // This should only return one value
                    resolve(data[method][0]);
                },
                error => {
                    console.log("A wild error appeared", error);
                    reject()
                })
        })
    }

    public clearInput(): void{
      this.itemInput = '';
    }

    /**
     * Checks if there are more moves in the shipment
     * @return {boolean} true if there are not
     */
    private checkReminders(): boolean {
        return this.shipmentLines.length == 0;
    }

    private loadShipmentLines() {
        let method = "stock.move";
        let json_constructor = new EncodeJSONRead;

        json_constructor.addNode(method, this.domain, this.fields);

        let json = json_constructor.createJson();

        this.trytonProvider.search(json).subscribe(
            data => {
                this.shipmentLines = data[method];
            },
            error => {
                console.log("A wild error ocurred", error)
            }
        )
    }
}
